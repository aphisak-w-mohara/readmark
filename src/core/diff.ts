/**
 * Rendering the difference between two versions of a Markdown document.
 *
 * The trick is to diff the *source* at word level and then render the merged
 * result through the ordinary parser, so inline formatting, links and code
 * all still work. Insert and delete runs travel through the parser as
 * control characters — the same technique the parser already uses internally
 * to park inline code and links — and become <ins>/<del> once the HTML is
 * built.
 *
 * Pure: strings in, strings out. No DOM, no IO.
 */
import { splitBlocks, stripMarks, MARK, type Block, type BlockKind } from "./blocks";
import { align, type Change } from "./align";
import { renderBlockList, stripRefDefs, type Heading, type MarkdownOptions } from "./markdown";

const { delOpen: DEL_OPEN, delClose: DEL_CLOSE, insOpen: INS_OPEN, insClose: INS_CLOSE } = MARK;

const DEL_RUN = new RegExp(DEL_OPEN + "[\\s\\S]*?" + DEL_CLOSE, "g");
const INS_RUN = new RegExp(INS_OPEN + "[\\s\\S]*?" + INS_CLOSE, "g");

/** The merged source as the before side saw it: deletions marked, insertions gone. */
const deleteSide = (merged: string): string => merged.replace(INS_RUN, "");

/** The merged source as the after side sees it: insertions marked, deletions gone. */
const insertSide = (merged: string): string => merged.replace(DEL_RUN, "");

/**
 * One token is a word, a run of whitespace, a punctuation mark, or a whole
 * inline construct. Constructs are matched first and kept intact: a diff
 * boundary in the middle of `[text](url)` produces broken Markdown.
 */
const TOKEN =
  /!\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*\)|`[^`]*`|<[^>]+>|\s+|[\p{L}\p{N}_'’-]+|[^\s]/gu;

export function tokenize(s: string): string[] {
  return s.match(TOKEN) ?? [];
}

/** Longest common subsequence of two token lists, as index pairs. */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Wrap a run of tokens. Whitespace at the edges stays outside the mark, so a
 * strikethrough never stretches across a line break; a run that is only
 * whitespace is not a change worth showing at all.
 */
function mark(run: string[], open: string, close: string): string {
  const joined = run.join("");
  if (!joined.trim()) return open === INS_OPEN ? joined : "";
  const [, lead, core, trail] = joined.match(/^(\s*)([\s\S]*?)(\s*)$/) as RegExpMatchArray;
  return lead + open + core + close + trail;
}

/**
 * Merge two versions of a block's source into one string carrying delete and
 * insert markers. Deletions are emitted before insertions at each divergence.
 */
export function wordDiff(before: string, after: string): string {
  const a = tokenize(stripMarks(before));
  const b = tokenize(stripMarks(after));
  const pairs = lcs(a, b);
  let out = "";
  let i = 0;
  let j = 0;
  const flush = (ai: number, bj: number) => {
    if (ai > i) out += mark(a.slice(i, ai), DEL_OPEN, DEL_CLOSE);
    if (bj > j) out += mark(b.slice(j, bj), INS_OPEN, INS_CLOSE);
  };
  for (const [ai, bj] of pairs) {
    flush(ai, bj);
    out += a[ai];
    i = ai + 1;
    j = bj + 1;
  }
  flush(a.length, b.length);
  return out;
}

/**
 * The line-leading structural markers of a block, in order. Lines with no
 * marker are dropped: a paragraph rewrapped from three lines to two has the
 * same structure, and counting its blank markers would say otherwise.
 */
function skeleton(src: string): string {
  return src
    .split("\n")
    .map((l) => (l.match(/^\s*(#{1,6}\s|[-+*]\s|\d+[.)]\s|>\s?|\|)/)?.[1] ?? "").trim())
    .filter(Boolean)
    .join("|");
}

/**
 * Whether a changed pair can carry inline marks. Code and raw HTML are shown
 * whole (word marks inside them would be nonsense or unsafe), and so is any
 * pair whose structure moved under it — a bullet list turned into a numbered
 * one has no sensible word-level reading.
 */
function canMark(before: Block, after: Block): boolean {
  if (before.kind !== after.kind) return false;
  if (before.kind === "code" || before.kind === "html") return false;
  if (before.kind === "heading") return true;
  return skeleton(before.src) === skeleton(after.src);
}

/** Merged source for a changed pair, structure taken from the after side. */
function mergedSrc(before: Block, after: Block): string {
  if (!canMark(before, after)) return after.src;
  if (after.kind === "heading") {
    const m = after.src.match(/^(\s*#{1,6}\s+)([\s\S]*)$/);
    if (!m) return after.src; // setext: the underline carries the level
    const bm = before.src.match(/^\s*#{1,6}\s+([\s\S]*)$/);
    return m[1] + wordDiff(bm ? bm[1] : before.src, m[2]);
  }
  return wordDiff(before.src, after.src);
}

export interface DiffRow {
  op: Change["op"];
  kind: BlockKind;
  /** Rendered HTML for the single-column view. */
  unified: string;
  /** Rendered HTML for the split view; empty on the side where it is absent. */
  before: string;
  after: string;
  /** True when `unified` carries word-level marks rather than a whole-block flag. */
  marked: boolean;
  /** Source line the row points at, on whichever side it exists. */
  line: number;
}

export interface DiffDoc {
  rows: DiffRow[];
  headings: (Heading & { changed: boolean })[];
  counts: { added: number; removed: number; changed: number };
  /**
   * Set when the file exists on only one side. A highlight that covers every
   * block says nothing, so the view drops the washes and states the fact
   * once instead.
   */
  whole: "added" | "removed" | null;
}

/** Remove element ids from a copy of the document (the split view's left column). */
const stripIds = (html: string): string => html.replace(/ id="[^"]*"/g, "");

const sentinelsToTags = (html: string): string =>
  html
    .replaceAll(DEL_OPEN, '<del class="diff-del">')
    .replaceAll(DEL_CLOSE, "</del>")
    .replaceAll(INS_OPEN, '<ins class="diff-ins">')
    .replaceAll(INS_CLOSE, "</ins>");

/** Diff two Markdown documents and render every block of the result. */
export function toDiffHtml(before: string, after: string, opts: MarkdownOptions = {}): DiffDoc {
  const beforeSrc = stripRefDefs(before);
  const afterSrc = stripRefDefs(after);
  const changes = align(splitBlocks(beforeSrc), splitBlocks(afterSrc));

  const unifiedSrcs: string[] = [];
  const beforeSrcs: string[] = [];
  const afterSrcs: string[] = [];
  const marked: boolean[] = [];

  for (const c of changes) {
    switch (c.op) {
      case "same":
        unifiedSrcs.push(c.after.src);
        beforeSrcs.push(c.before.src);
        afterSrcs.push(c.after.src);
        marked.push(false);
        break;
      case "changed": {
        const ok = canMark(c.before, c.after);
        const merged = mergedSrc(c.before, c.after);
        unifiedSrcs.push(merged);
        // Each column carries only its own half of the edit, so the split
        // view marks what left on the left and what arrived on the right.
        beforeSrcs.push(ok ? deleteSide(merged) : c.before.src);
        afterSrcs.push(ok ? insertSide(merged) : c.after.src);
        marked.push(ok);
        break;
      }
      case "added":
        unifiedSrcs.push(c.after.src);
        beforeSrcs.push("");
        afterSrcs.push(c.after.src);
        marked.push(false);
        break;
      case "removed":
        unifiedSrcs.push(c.before.src);
        beforeSrcs.push(c.before.src);
        afterSrcs.push("");
        marked.push(false);
        break;
    }
  }

  const uni = renderBlockList(unifiedSrcs, { ...opts, refsFrom: after + "\n" + before });
  const bef = renderBlockList(beforeSrcs, { ...opts, refsFrom: before });
  const aft = renderBlockList(afterSrcs, { ...opts, refsFrom: after });

  const rows: DiffRow[] = changes.map((c, i) => ({
    op: c.op,
    kind: c.op === "removed" ? c.before.kind : c.after.kind,
    unified: sentinelsToTags(uni.html[i]),
    // The before column is a second copy of the document: it must not carry
    // heading ids, or every anchor in the page would be ambiguous.
    before: stripIds(sentinelsToTags(bef.html[i])),
    after: sentinelsToTags(aft.html[i]),
    marked: marked[i],
    line: c.op === "removed" ? c.before.line : c.after.line,
  }));

  // A heading is marked changed when its own row changed, or anything under
  // it did — that dot in the outline is what makes a long document scannable.
  const headings: (Heading & { changed: boolean })[] = [];
  let seen = 0; // every heading row consumed one slot in the unified render
  let current = -1;
  rows.forEach((r) => {
    if (r.kind === "heading") {
      const h = uni.headings[seen++];
      if (r.op === "removed") return;
      if (h) headings.push({ ...h, changed: r.op !== "same" });
      current = headings.length - 1;
    } else if (r.op !== "same" && current >= 0) {
      headings[current].changed = true;
    }
  });

  const counts = { added: 0, removed: 0, changed: 0 };
  for (const r of rows) {
    if (r.op === "added") counts.added++;
    else if (r.op === "removed") counts.removed++;
    else if (r.op === "changed") counts.changed++;
  }

  const whole =
    rows.length === 0
      ? null
      : rows.every((r) => r.op === "added")
        ? "added"
        : rows.every((r) => r.op === "removed")
          ? "removed"
          : null;

  return { rows, headings, counts, whole };
}
