/**
 * Matching the blocks of two versions of a document.
 *
 * Alignment happens on `Block.text` — inline markup stripped, whitespace
 * collapsed — which is what makes a rewrapped paragraph align as itself
 * instead of exploding into a removal and an addition. That single choice is
 * the difference between this and a line-based diff.
 *
 * Pure: two block lists in, a list of changes out.
 */
import { normalize, type Block } from "./blocks";

export type Change =
  | { op: "same"; before: Block; after: Block }
  | { op: "changed"; before: Block; after: Block }
  | { op: "added"; after: Block }
  | { op: "removed"; before: Block };

/**
 * How alike two blocks are, 0 to 1, by shared words. Used only to decide
 * whether an unmatched pair is one edited block or two unrelated ones.
 */
export function similarity(a: string, b: string): number {
  const wa = a.split(/\s+/).filter(Boolean);
  const wb = b.split(/\s+/).filter(Boolean);
  if (!wa.length && !wb.length) return 1;
  if (!wa.length || !wb.length) return 0;
  const pool = new Map<string, number>();
  for (const w of wa) pool.set(w, (pool.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wb) {
    const n = pool.get(w) ?? 0;
    if (n > 0) {
      common++;
      pool.set(w, n - 1);
    }
  }
  return (2 * common) / (wa.length + wb.length);
}

/** Above this, an unmatched pair of the same kind is treated as one edit. */
const PAIR_THRESHOLD = 0.4;

/** Longest common subsequence over block keys, as index pairs. */
function lcsPairs(a: Block[], b: Block[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] =
        a[i].text === b[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].text === b[j].text) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Pair off the blocks that fell between two anchors. Same-kind blocks that
 * are similar enough are one edit; everything else is an independent add or
 * remove. Order is preserved so the result reads top to bottom.
 */
function reconcile(before: Block[], after: Block[]): Change[] {
  const out: Change[] = [];
  const usedAfter = new Set<number>();
  const matched = new Map<number, number>();

  before.forEach((b, bi) => {
    let best = -1;
    let bestScore = PAIR_THRESHOLD;
    after.forEach((a, ai) => {
      if (usedAfter.has(ai) || a.kind !== b.kind) return;
      const s = similarity(b.text, a.text);
      if (s > bestScore) {
        bestScore = s;
        best = ai;
      }
    });
    if (best >= 0) {
      usedAfter.add(best);
      matched.set(bi, best);
    }
  });

  let ai = 0;
  before.forEach((b, bi) => {
    const partner = matched.get(bi);
    if (partner === undefined) {
      out.push({ op: "removed", before: b });
      return;
    }
    while (ai < partner) {
      if (!isMatchedTarget(matched, ai)) out.push({ op: "added", after: after[ai] });
      ai++;
    }
    out.push({ op: "changed", before: b, after: after[partner] });
    ai = partner + 1;
  });
  while (ai < after.length) {
    if (!isMatchedTarget(matched, ai)) out.push({ op: "added", after: after[ai] });
    ai++;
  }
  return out;
}

function isMatchedTarget(matched: Map<number, number>, ai: number): boolean {
  for (const v of matched.values()) if (v === ai) return true;
  return false;
}

/** Align two documents' blocks into an ordered list of changes. */
export function align(before: Block[], after: Block[]): Change[] {
  const anchors = lcsPairs(before, after);
  const out: Change[] = [];
  let bi = 0;
  let ai = 0;

  for (const [b, a] of anchors) {
    if (b > bi || a > ai) out.push(...reconcile(before.slice(bi, b), after.slice(ai, a)));
    // Keys match, so this is the same block — unless the source differs by
    // more than whitespace, which is a real edit the key deliberately hides
    // (emphasis added, heading level changed).
    out.push(
      normalize(before[b].src) === normalize(after[a].src)
        ? { op: "same", before: before[b], after: after[a] }
        : { op: "changed", before: before[b], after: after[a] },
    );
    bi = b + 1;
    ai = a + 1;
  }
  if (bi < before.length || ai < after.length)
    out.push(...reconcile(before.slice(bi), after.slice(ai)));

  return out;
}
