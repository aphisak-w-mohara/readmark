/**
 * Reading-metric math. Every function is pure: the DOM measures, these decide.
 * The viewer reads offsets/centers off live elements and hands the numbers here.
 */

/** Count whitespace-delimited words in a string. */
export function countWords(text: string): number {
  return (text.trim().match(/\S+/g) || []).length;
}

/** Estimated minutes to read `words`, floored at 1. */
export function readingTime(words: number, wpm = 220): number {
  return Math.max(1, Math.round(words / wpm));
}

/** Scroll position as a 0–100 percentage. */
export function progressPct(scrollTop: number, scrollH: number, clientH: number): number {
  const max = scrollH - clientH;
  if (max <= 0) return 0;
  return Math.min(100, Math.max(0, (scrollTop / max) * 100));
}

/**
 * The id of the last heading whose top is at or above `probe`
 * (typically scrollTop + a small threshold). Null before the first heading.
 */
export function activeHeadingId(
  headings: { id: string; top: number }[],
  probe: number,
): string | null {
  let active: string | null = null;
  for (const h of headings) {
    if (h.top <= probe) active = h.id;
    else break;
  }
  return active;
}

/** Index of the block whose center is nearest the viewport center (-1 if none). */
export function focusTargetIndex(centers: number[], viewCenter: number): number {
  let best = -1;
  let bestDist = Infinity;
  centers.forEach((c, i) => {
    const d = Math.abs(c - viewCenter);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}
