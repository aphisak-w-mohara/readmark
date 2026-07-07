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

const SENT = String.fromCharCode(1); // sentinel that brackets protected inline-code slots

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

function inline(src: string): string {
  const codes: string[] = [];
  let t = src.replace(/(`+)([\s\S]*?)\1/g, (_m, _tk, code: string) => {
    codes.push(code.replace(/^ | $/g, ""));
    return SENT + (codes.length - 1) + SENT;
  });
  t = escapeHtml(t);
  // images
  t = t.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, alt: string, url: string, ti?: string) =>
      `<img src="${escapeAttr(safeUrl(url))}" alt="${escapeAttr(alt)}"${ti ? ` title="${escapeAttr(ti)}"` : ""} loading="lazy">`,
  );
  // links
  t = t.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (_m, txt: string, href: string, ti?: string) =>
      `<a href="${escapeAttr(safeUrl(href))}"${ti ? ` title="${escapeAttr(ti)}"` : ""} target="_blank" rel="noopener">${txt}</a>`,
  );
  // bare autolinks
  t = t.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;])/g,
    (_m, pre: string, url: string) =>
      `${pre}<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${url}</a>`,
  );
  // emphasis
  t = t
    .replace(/\*\*([^\s](?:[^*]*[^\s])?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__([^\s](?:[^_]*[^\s])?)__/g, "$1<strong>$2</strong>");
  t = t
    .replace(/(^|[^*])\*([^\s*](?:[^*]*[^\s*])?)\*/g, "$1<em>$2</em>")
    .replace(/(^|[^\w_])_([^\s_](?:[^_]*[^\s_])?)_/g, "$1<em>$2</em>");
  t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // hard break
  t = t.replace(/ {2,}\n/g, "<br>\n");
  // restore inline code
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
      out.push(renderCode(buf.join("\n"), lang, ctx.hl));
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
    // paragraph
    const buf: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^\s*(#{1,6}\s|>|`{3,}|~{3,}|([-*_])\s*\2\s*\2)/.test(lines[i]) &&
      !/^(\s*)([-+*]|\d+[.)])\s+/.test(lines[i])
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
  const headings: Heading[] = [];
  const html = parseBlocks(src, { hl, slug: makeSlugger(), headings });
  const h1 = headings.find((x) => x.level === 1);
  const title = (h1 ? h1.text : "Untitled").trim().slice(0, 80) || "Untitled";
  return { html, headings, title };
}
