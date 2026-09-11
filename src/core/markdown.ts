/**
 * Markdown -> HTML. Deep and pure: a string in, structured HTML out.
 *
 * The one dependency a caller must know about is the syntax highlighter, which
 * is injected (default: escape-only). That internal seam lets tests drive the
 * parser with a fake highlighter and assert code blocks are wired correctly.
 */
import { escapeHtml, escapeAttr, safeUrl } from "./escape";
import { makeSlugger } from "./slug";
import {
  splitBlocks,
  fenceParts,
  stripInline,
  afterText,
  containerEnd,
  type Block,
} from "./blocks";

export interface Heading {
  level: number;
  text: string;
  id: string;
}
export interface Rendered {
  html: string;
  headings: Heading[];
  title: string;
}
export type Highlighter = (code: string, lang: string) => string;
export interface MarkdownOptions {
  highlight?: Highlighter;
}

const SENT = String.fromCharCode(1); // brackets protected inline-code slots
const SENT2 = String.fromCharCode(2); // brackets protected link/image HTML
const SENT3 = String.fromCharCode(3); // brackets pass-through raw HTML tags

/** Apply emphasis / strong / strikethrough to already-escaped text. */
function emph(s: string): string {
  return s
    .replace(/\*\*([^\s](?:[^*]*[^\s])?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__([^\s](?:[^_]*[^\s])?)__/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*])\*([^\s*](?:[^*]*[^\s*])?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^\w_])_([^\s_](?:[^_]*[^\s_])?)_/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
}

// Link reference definitions collected per-document (reset in toHtml).
let REFS: Record<string, { url: string; title?: string }> = {};

function anchor(text: string, url: string, title?: string): string {
  return `<a href="${escapeAttr(safeUrl(url))}"${title ? ` title="${escapeAttr(title)}"` : ""} target="_blank" rel="noopener">${text}</a>`;
}

const REF_DEF = /^[ ]{0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+["'(]([^"')]+)["')])?[ \t]*$/gm;

/** Remove `[label]: url "title"` definitions without recording them. */
export function stripRefDefs(src: string): string {
  return src.replace(REF_DEF, "");
}

/** Pull `[label]: url "title"` definitions out of the source and record them. */
function extractRefs(src: string): string {
  return src.replace(REF_DEF, (_m, label: string, url: string, title?: string) => {
    REFS[label.trim().toLowerCase()] = { url, title };
    return "";
  });
}

function inline(src: string): string {
  const codes: string[] = [];
  const stashed: string[] = [];
  // Park finished link/image HTML behind a sentinel so later passes (esp. the
  // underscore-emphasis rule vs. target="_blank") can't corrupt it.
  const stash = (h: string): string => {
    stashed.push(h);
    return SENT2 + (stashed.length - 1) + SENT2;
  };

  const tags: string[] = [];
  let t = src.replace(/(`+)([\s\S]*?)\1/g, (_m, _tk, code: string) => {
    codes.push(code.replace(/^ | $/g, ""));
    return SENT + (codes.length - 1) + SENT;
  });
  // Park valid-looking HTML tags (and comments) so raw HTML passes through; a
  // stray "<" is still escaped below. The view layer sanitizes the result.
  t = t.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->/g, (m) => {
    tags.push(m);
    return SENT3 + (tags.length - 1) + SENT3;
  });
  t = escapeHtml(t);
  // angle autolinks: <https://example.com>
  t = t.replace(/&lt;(https?:\/\/[^\s&<>]+)&gt;/g, (_m, url: string) => stash(anchor(url, url)));
  // images
  t = t.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, alt: string, url: string, ti?: string) =>
      stash(
        `<img src="${escapeAttr(safeUrl(url))}" alt="${escapeAttr(alt)}"${ti ? ` title="${escapeAttr(ti)}"` : ""} loading="lazy">`,
      ),
  );
  // inline links (emphasis applied to the link text, then the whole anchor parked)
  t = t.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, txt: string, href: string, ti?: string) => stash(anchor(emph(txt), href, ti)),
  );
  // reference links: [text][label] and collapsed [text][]
  t = t.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, (m, text: string, label: string) => {
    const ref = REFS[(label || text).trim().toLowerCase()];
    return ref ? stash(anchor(emph(text), ref.url, ref.title)) : m;
  });
  // shortcut reference links: [label]
  t = t.replace(/\[([^\]]+)\]/g, (m, label: string) => {
    const ref = REFS[label.trim().toLowerCase()];
    return ref ? stash(anchor(emph(label), ref.url, ref.title)) : m;
  });
  // bare autolinks
  t = t.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;])/g,
    (_m, pre: string, url: string) => `${pre}${stash(anchor(url, url))}`,
  );
  // emphasis on the remaining prose (anchors are safely parked)
  t = emph(t);
  // hard break
  t = t.replace(/ {2,}\n/g, "<br>\n");
  // restore parked link/image HTML, raw HTML tags, then inline code
  t = t.replace(new RegExp(SENT2 + "(\\d+)" + SENT2, "g"), (_m, i: string) => stashed[+i]);
  t = t.replace(new RegExp(SENT3 + "(\\d+)" + SENT3, "g"), (_m, i: string) => tags[+i]);
  t = t.replace(
    new RegExp(SENT + "(\\d+)" + SENT, "g"),
    (_m, i: string) => `<code>${escapeHtml(codes[+i])}</code>`,
  );
  return t;
}

interface ListItem {
  text: string;
  task: boolean | null;
  subs: ListNode[];
}
interface ListNode {
  ordered: boolean;
  indent: number;
  items: ListItem[];
}

function renderList(lines: string[]): string {
  const roots: ListNode[] = [];
  const stack: ListNode[] = [];
  const push = (indent: number, ordered: boolean, item: ListItem) => {
    while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
    const top = stack[stack.length - 1];
    if (!top || top.indent < indent) {
      const list: ListNode = { ordered, indent, items: [] };
      if (top) top.items[top.items.length - 1].subs.push(list);
      else roots.push(list);
      stack.push(list);
      list.items.push(item);
    } else if (top.indent === indent) {
      if (top.ordered !== ordered) {
        const list: ListNode = { ordered, indent, items: [item] };
        const parent = stack.length > 1 ? stack[stack.length - 2] : null;
        if (parent) parent.items[parent.items.length - 1].subs.push(list);
        else roots.push(list);
        stack[stack.length - 1] = list;
      } else {
        top.items.push(item);
      }
    }
  };
  for (const raw of lines) {
    const m = raw.match(/^(\s*)([-+*]|\d+[.)])\s+(.*)$/);
    if (m) {
      const indent = m[1].replace(/\t/g, "    ").length;
      const ordered = /\d/.test(m[2]);
      const text = m[3];
      const task = text.match(/^\[([ xX])\]\s+(.*)$/);
      push(indent, ordered, {
        text: task ? task[2] : text,
        task: task ? task[1].toLowerCase() === "x" : null,
        subs: [],
      });
    } else {
      const list = stack[stack.length - 1];
      if (list && list.items.length) list.items[list.items.length - 1].text += " " + raw.trim();
    }
  }
  const build = (list: ListNode): string => {
    let h = list.ordered ? "<ol>" : "<ul>";
    for (const it of list.items) {
      const cls = it.task !== null ? ' class="task"' : "";
      const box =
        it.task !== null ? `<input type="checkbox" disabled${it.task ? " checked" : ""}> ` : "";
      h += `<li${cls}>${box}${inline(it.text)}`;
      for (const s of it.subs) h += build(s);
      h += "</li>";
    }
    return h + (list.ordered ? "</ol>" : "</ul>");
  };
  return roots.map(build).join("");
}

const splitRow = (l: string): string[] =>
  l
    .replace(/^\s*\|?/, "")
    .replace(/\|?\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((s) => s.replace(/\\\|/g, "|"));

function renderTable(header: string[], align: string[], rows: string[][]): string {
  const cell = (c: string, i: number, tag: string) => {
    const a = align[i] ? ` align="${align[i]}"` : "";
    return `<${tag}${a}>${inline(c.trim())}</${tag}>`;
  };
  let h = '<div class="table-wrap"><table><thead><tr>';
  header.forEach((c, i) => (h += cell(c, i, "th")));
  h += "</tr></thead><tbody>";
  rows.forEach((r) => {
    h += "<tr>";
    r.forEach((c, i) => (h += cell(c, i, "td")));
    h += "</tr>";
  });
  return h + "</tbody></table></div>";
}

function renderCode(code: string, lang: string, hl: Highlighter): string {
  const label = (lang || "").replace(/^(console|text|txt|plain)$/i, "") || "code";
  return `<div class="codeblock"><div class="codebar"><span class="codelang">${escapeHtml(label)}</span><button class="copybtn" type="button">Copy</button></div><pre class="code"><code>${hl(code, lang)}</code></pre></div>`;
}

interface Ctx {
  hl: Highlighter;
  slug: (t: string) => string;
  headings: Heading[];
}

/** Render one already-split block to HTML. */
function renderBlock(b: Block, ctx: Ctx): string {
  switch (b.kind) {
    case "code": {
      const { lang, body } = fenceParts(b.src);
      if (lang.toLowerCase() === "mermaid")
        // Placeholder rendered into an SVG diagram by the view layer.
        return `<div class="mermaid"><pre class="mermaid-src">${escapeHtml(body)}</pre></div>`;
      return renderCode(body, lang, ctx.hl);
    }
    case "heading": {
      const lines = b.src.split("\n");
      const atx = lines[0].match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      const level = atx ? atx[1].length : lines[1].trim()[0] === "=" ? 1 : 2;
      const raw = atx ? atx[2] : lines[0].trim();
      // The outline reads the after side: deleted runs drop out, inserted
      // ones stay, so an id is the same whether or not marks are shown.
      const text = stripInline(afterText(raw));
      const id = ctx.slug(text);
      ctx.headings.push({ level, text, id });
      return `<h${level} id="${id}">${inline(raw)}</h${level}>`;
    }
    case "hr":
      return "<hr>";
    case "quote":
      return `<blockquote>${parseBlocks(b.src.replace(/^\s*>\s?/gm, ""), ctx)}</blockquote>`;
    case "table": {
      const lines = b.src.split("\n");
      const header = splitRow(lines[0]);
      const align = splitRow(lines[1]).map((c) => {
        c = c.trim();
        const l = c.startsWith(":");
        const r = c.endsWith(":");
        return r && l ? "center" : r ? "right" : l ? "left" : "";
      });
      return renderTable(header, align, lines.slice(2).map(splitRow));
    }
    case "list":
      return renderList(b.src.split("\n"));
    case "html": {
      // A container block keeps its open and close tags together — so the
      // element survives being one row in the diff — while its contents
      // still go through the parser, which is the whole point of writing
      // a table or a list inside <details>.
      const lines = b.src.split("\n");
      // A comment's body is not content: rendering it would turn commented
      // -out markdown into live HTML that only a "-->" keeps hidden.
      if (/^\s*<!--/.test(lines[0])) return b.src;
      // The same answer the splitter used, not a second guess at it.
      if (containerEnd(lines, 0) !== lines.length || lines.length < 3) return b.src;
      return `${lines[0]}\n${parseBlocks(lines.slice(1, -1).join("\n"), ctx)}\n${lines[lines.length - 1]}`;
    }
    default:
      return `<p>${inline(b.src)}</p>`;
  }
}

function parseBlocks(src: string, ctx: Ctx): string {
  return splitBlocks(src)
    .map((b) => renderBlock(b, ctx))
    .join("\n");
}

/**
 * Render a list of block sources one at a time, sharing a single slugger and
 * one set of link definitions. The differ needs each block's HTML separately
 * so it can lay them out in rows; `toHtml` only ever hands back one string.
 */
export function renderBlockList(
  srcs: string[],
  opts: MarkdownOptions & { refsFrom?: string } = {},
): { html: string[]; headings: Heading[] } {
  const hl = opts.highlight ?? ((c: string) => escapeHtml(c));
  REFS = {};
  if (opts.refsFrom !== undefined) extractRefs(opts.refsFrom);
  const ctx: Ctx = { hl, slug: makeSlugger(), headings: [] };
  const html = srcs.map((s) =>
    splitBlocks(s)
      .map((b) => renderBlock(b, ctx))
      .join("\n"),
  );
  return { html, headings: ctx.headings };
}

/** Render Markdown to HTML plus the outline and title derived during the parse. */
export function toHtml(src: string, opts: MarkdownOptions = {}): Rendered {
  const hl = opts.highlight ?? ((c: string) => escapeHtml(c));
  REFS = {};
  const cleaned = extractRefs(src);
  const headings: Heading[] = [];
  const html = parseBlocks(cleaned, { hl, slug: makeSlugger(), headings });
  const h1 = headings.find((x) => x.level === 1);
  const title = (h1 ? h1.text : "Untitled").trim().slice(0, 80) || "Untitled";
  return { html, headings, title };
}
