/**
 * Markdown -> HTML. Deep and pure: a string in, structured HTML out.
 *
 * The one dependency a caller must know about is the syntax highlighter, which
 * is injected (default: escape-only). That internal seam lets tests drive the
 * parser with a fake highlighter and assert code blocks are wired correctly.
 */
import { escapeHtml, escapeAttr, safeUrl } from "./escape";
import { makeSlugger } from "./slug";

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

/** Strip inline markdown to plain text (for TOC labels and the title). */
function stripInline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .trim();
}

// Link reference definitions collected per-document (reset in toHtml).
let REFS: Record<string, { url: string; title?: string }> = {};

function anchor(text: string, url: string, title?: string): string {
  return `<a href="${escapeAttr(safeUrl(url))}"${title ? ` title="${escapeAttr(title)}"` : ""} target="_blank" rel="noopener">${text}</a>`;
}

/** Pull `[label]: url "title"` definitions out of the source and record them. */
function extractRefs(src: string): string {
  return src.replace(
    /^[ ]{0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+["'(]([^"')]+)["')])?[ \t]*$/gm,
    (_m, label: string, url: string, title?: string) => {
      REFS[label.trim().toLowerCase()] = { url, title };
      return "";
    },
  );
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

function parseBlocks(src: string, ctx: Ctx): string {
  src = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;
  const isBlank = (l: string) => /^\s*$/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    // fenced code
    const f = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/);
    if (f) {
      const ch = f[2][0];
      const len = f[2].length;
      const lang = f[3] || "";
      const buf: string[] = [];
      i++;
      const close = new RegExp("^\\s*" + (ch === "`" ? "`" : "~") + "{" + len + ",}\\s*$");
      while (i < lines.length && !close.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      const fenced = buf.join("\n");
      if (lang.toLowerCase() === "mermaid") {
        // Placeholder rendered into an SVG diagram by the view layer.
        out.push(`<div class="mermaid"><pre class="mermaid-src">${escapeHtml(fenced)}</pre></div>`);
      } else {
        out.push(renderCode(fenced, lang, ctx.hl));
      }
      continue;
    }
    // ATX heading
    const h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const level = h[1].length;
      const text = stripInline(h[2]);
      const id = ctx.slug(text);
      ctx.headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }
    // setext heading
    if (
      i + 1 < lines.length &&
      /^\s*(=+|-+)\s*$/.test(lines[i + 1]) &&
      !isBlank(line) &&
      !/^\s*[-+*]\s/.test(line)
    ) {
      const level = lines[i + 1].trim()[0] === "=" ? 1 : 2;
      const text = stripInline(line.trim());
      const id = ctx.slug(text);
      ctx.headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(line.trim())}</h${level}>`);
      i += 2;
      continue;
    }
    // hr
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    // blockquote
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (
        i < lines.length &&
        !isBlank(lines[i]) &&
        !/^\s*(#{1,6}\s|`{3,}|~{3,})/.test(lines[i])
      ) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${parseBlocks(buf.join("\n"), ctx)}</blockquote>`);
      continue;
    }
    // table
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) &&
      lines[i + 1].includes("-")
    ) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => {
        c = c.trim();
        const l = c.startsWith(":");
        const r = c.endsWith(":");
        return r && l ? "center" : r ? "right" : l ? "left" : "";
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(renderTable(header, align, rows));
      continue;
    }
    // list
    if (/^(\s*)([-+*]|\d+[.)])\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length) {
        if (/^(\s*)([-+*]|\d+[.)])\s+/.test(lines[i]) || /^\s+\S/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        } else if (
          isBlank(lines[i]) &&
          i + 1 < lines.length &&
          (/^(\s*)([-+*]|\d+[.)])\s+/.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))
        ) {
          i++;
        } else break;
      }
      out.push(renderList(buf));
      continue;
    }
    // raw HTML block (e.g. <details>/<summary>): pass through verbatim until a
    // blank line, so markdown between the tags still renders. Sanitized by the
    // view layer. Autolink-only lines (<https://…>) fall through to a paragraph.
    if (/^\s*<(\/?[a-zA-Z][\w-]*|!--)/.test(line) && !/^\s*<https?:/i.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && !isBlank(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push(buf.join("\n"));
      continue;
    }
    // paragraph
    const buf: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^\s*(#{1,6}\s|>|`{3,}|~{3,}|([-*_])\s*\2\s*\2)/.test(lines[i]) &&
      !/^(\s*)([-+*]|\d+[.)])\s+/.test(lines[i]) &&
      !/^\s*<(\/?[a-zA-Z][\w-]*|!--)/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(buf.join("\n"))}</p>`);
  }
  return out.join("\n");
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
