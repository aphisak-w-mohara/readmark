/**
 * Splitting Markdown source into blocks.
 *
 * One walker, two consumers: the renderer turns each block into HTML, the
 * differ aligns blocks between two versions of a document. Keeping the
 * boundary rules in one place is the point — two walkers would drift, and a
 * differ that disagrees with the renderer about where a paragraph ends
 * produces diffs that don't match what you're reading.
 *
 * Pure: a string in, a list of source slices out. No DOM, no IO.
 */

export type BlockKind = "heading" | "para" | "list" | "code" | "quote" | "table" | "html" | "hr";

export interface Block {
  kind: BlockKind;
  /** Verbatim source of the block, newlines intact. */
  src: string;
  /** Alignment key: inline markup stripped, whitespace collapsed. */
  text: string;
  /** 1-based line in the source where the block starts. */
  line: number;
}

/** Strip inline markdown to plain text (TOC labels, titles, alignment keys). */
export function stripInline(s: string): string {
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

/** Normalize a source slice for equality: whitespace collapsed, edges trimmed. */
export function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Split a fenced-code block's source into its language and its body. */
export function fenceParts(src: string): { lang: string; body: string } {
  const lines = src.split("\n");
  const open = lines[0].match(/^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/);
  const lang = open ? open[3] || "" : "";
  const ch = open ? open[2][0] : "`";
  const len = open ? open[2].length : 3;
  const close = new RegExp("^\\s*" + (ch === "`" ? "`" : "~") + "{" + len + ",}\\s*$");
  const last = lines.length > 1 && close.test(lines[lines.length - 1]);
  return { lang, body: lines.slice(1, last ? -1 : undefined).join("\n") };
}

/**
 * Diff markers. The differ threads these control characters through the
 * parser so insert/delete runs survive rendering; built from char codes so
 * they never appear literally in a regex.
 */
export const MARK = {
  delOpen: String.fromCharCode(4),
  delClose: String.fromCharCode(5),
  insOpen: String.fromCharCode(6),
  insClose: String.fromCharCode(7),
} as const;

const DEL_RUN = new RegExp(MARK.delOpen + "[\\s\\S]*?" + MARK.delClose, "g");
const INS_TAGS = new RegExp("[" + MARK.insOpen + MARK.insClose + "]", "g");
const ANY_MARK = new RegExp(
  "[" + MARK.delOpen + MARK.delClose + MARK.insOpen + MARK.insClose + "]",
  "g",
);

/** Read marked source as the after side: deletions dropped, insertions kept. */
export function afterText(s: string): string {
  return s.replace(DEL_RUN, "").replace(INS_TAGS, "");
}

/** Drop every marker, keeping all the text on both sides. */
export function stripMarks(s: string): string {
  return s.replace(ANY_MARK, "");
}

const isBlank = (l: string) => /^\s*$/.test(l);

/** Elements that never wrap content, so they cannot span a blank line. */
const VOID = new Set(
  "area base br col embed hr img input link meta param source track wbr".split(" "),
);

/**
 * Elements whose body is literal text, never Markdown. Beyond mangling
 * the text, parsing these puts headings the reader can never see into the
 * outline — and <title>'s into the browser tab.
 */
export const LITERAL = new Set(
  "pre script style textarea title iframe xmp noembed noframes noscript plaintext".split(" "),
);

/** A line opening an HTML comment, whose body is not even text. */
export const COMMENT = /^\s*<!--/;

/** The tag a line opens, lowercased, or undefined if it opens none. */
export const tagOf = (line: string): string | undefined =>
  line.match(/^\s*<([a-zA-Z][\w-]*)/)?.[1].toLowerCase();

/**
 * Where the container opened at `start` closes, as an exclusive end index,
 * or null when this is not a closed container.
 *
 * A container that wraps content — <details> around a table, say — has
 * blank lines inside it, and ending the block at the first one splits the
 * element apart: rendered a block at a time, the opening tag and its
 * contents become siblings and the element silently stops working.
 *
 * Both the splitter and the renderer ask this, so they cannot disagree
 * about it.
 */
export function containerEnd(lines: string[], start: number): number | null {
  // A comment closes on a literal, not on a matching tag, so it needs its
  // own scan — and it is the container that most needs one: left open, the
  // browser reads the rest of the page as its body.
  if (COMMENT.test(lines[start])) {
    for (let n = start; n < lines.length; n++) if (lines[n].includes("-->")) return n + 1;
    return null;
  }
  const tag = tagOf(lines[start]);
  if (!tag || VOID.has(tag) || /\/>\s*$/.test(lines[start])) return null;
  const openRe = new RegExp(`<${tag}(?=[\\s/>]|$)`, "gi");
  const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 0;
  for (let n = start; n < lines.length; n++) {
    // Depth only moves on lines with a tag; skipping the rest keeps an
    // unclosed opener from costing a full two-regex scan of every line.
    if (!lines[n].includes("<")) continue;
    depth += (lines[n].match(openRe) ?? []).length;
    depth -= (lines[n].match(closeRe) ?? []).length;
    if (depth <= 0) return n + 1;
  }
  return null; // never closed: the caller falls back rather than swallowing the file
}

/** Where a non-container raw HTML block ends: at the next blank line. */
function blankEnd(lines: string[], start: number): number {
  let n = start;
  while (n < lines.length && !isBlank(lines[n])) n++;
  return n;
}
const LIST_ITEM = /^(\s*)([-+*]|\d+[.)])\s+/;
const HTML_OPEN = /^\s*<(\/?[a-zA-Z][\w-]*|!--)/;

/**
 * Alignment key for a block. Code keeps its exact body (indentation is
 * meaning); prose is reduced to words so that rewrapping a paragraph is
 * invisible to the differ — which is the whole reason this exists.
 */
function keyOf(kind: BlockKind, src: string): string {
  if (kind === "hr") return "hr";
  if (kind === "code") {
    const { lang, body } = fenceParts(src);
    return (
      lang +
      "\n" +
      body
        .split("\n")
        .map((l) => l.replace(/\s+$/, ""))
        .join("\n")
    );
  }
  if (kind === "heading") {
    const first = src.split("\n")[0];
    return normalize(stripInline(first.replace(/^\s*#{1,6}\s+/, "").replace(/\s*#*\s*$/, "")));
  }
  if (kind === "list") {
    return src
      .split("\n")
      .map((l) => {
        const m = l.match(LIST_ITEM);
        if (!m) return l.trim();
        return (/\d/.test(m[2]) ? "o " : "u ") + l.slice(m[0].length).trim();
      })
      .map((l) => normalize(stripInline(l)))
      .filter(Boolean)
      .join(" • ");
  }
  if (kind === "quote") {
    return normalize(stripInline(src.replace(/^\s*>\s?/gm, "")));
  }
  return normalize(stripInline(src));
}

/** Walk Markdown source once and return its top-level blocks in order. */
export function splitBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const out: Block[] = [];
  let i = 0;

  // The last line each closing token appears on, found once and reused.
  // An opener with none ahead of it can only fall back, so it is refused
  // without the scan to end-of-file that discovering it would cost —
  // otherwise a document of unterminated tags is quadratic. Only absence
  // generalises this way: a depth mismatch like <div><div></div> fails
  // from the first opener and succeeds from the second.
  const lastCloser = new Map<string, number>();
  const closerAhead = (token: string, from: number): boolean => {
    let last = lastCloser.get(token);
    if (last === undefined) {
      for (last = lines.length - 1; last >= 0 && !lines[last].includes(token); last--);
      lastCloser.set(token, last);
    }
    return last >= from;
  };

  const push = (kind: BlockKind, start: number, end: number) => {
    const body = lines.slice(start, end).join("\n");
    out.push({ kind, src: body, text: keyOf(kind, body), line: start + 1 });
  };

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const start = i;

    // fenced code
    const f = line.match(/^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/);
    if (f) {
      const ch = f[2][0];
      const len = f[2].length;
      const close = new RegExp("^\\s*" + (ch === "`" ? "`" : "~") + "{" + len + ",}\\s*$");
      i++;
      while (i < lines.length && !close.test(lines[i])) i++;
      i++; // the closing fence (or past the end, for an unterminated block)
      push("code", start, Math.min(i, lines.length));
      continue;
    }

    // ATX heading
    if (/^(#{1,6})\s+(.*?)\s*#*\s*$/.test(line)) {
      i++;
      push("heading", start, i);
      continue;
    }

    // setext heading
    if (i + 1 < lines.length && /^\s*(=+|-+)\s*$/.test(lines[i + 1]) && !/^\s*[-+*]\s/.test(line)) {
      i += 2;
      push("heading", start, i);
      continue;
    }

    // hr
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      i++;
      push("hr", start, i);
      continue;
    }

    // blockquote
    if (/^\s*>/.test(line)) {
      while (i < lines.length && !isBlank(lines[i]) && !/^\s*(#{1,6}\s|`{3,}|~{3,})/.test(lines[i]))
        i++;
      push("quote", start, i);
      continue;
    }

    // table
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(lines[i + 1]) &&
      lines[i + 1].includes("-")
    ) {
      i += 2;
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) i++;
      push("table", start, i);
      continue;
    }

    // list
    if (LIST_ITEM.test(line)) {
      while (i < lines.length) {
        if (LIST_ITEM.test(lines[i]) || /^\s+\S/.test(lines[i])) i++;
        else if (
          isBlank(lines[i]) &&
          i + 1 < lines.length &&
          (LIST_ITEM.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))
        )
          i++;
        else break;
      }
      push("list", start, i);
      continue;
    }

    // raw HTML block
    if (HTML_OPEN.test(line) && !/^\s*<https?:/i.test(line)) {
      const tag = tagOf(line);
      const closer = COMMENT.test(line) ? "-->" : tag && `</${tag}`;
      const end = closer && !closerAhead(closer, i) ? null : containerEnd(lines, i);
      i = end ?? blankEnd(lines, i);
      push("html", start, i);
      continue;
    }

    // paragraph
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^\s*(#{1,6}\s|>|`{3,}|~{3,}|([-*_])\s*\2\s*\2)/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !HTML_OPEN.test(lines[i])
    )
      i++;
    push("para", start, i);
  }

  return out;
}
