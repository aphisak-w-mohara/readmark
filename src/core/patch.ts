/**
 * Which lines of a changed file will accept a review comment.
 *
 * GitHub does not take a comment on any line you like: it must be a line
 * the diff actually shows. A hunk header `@@ -152,25 +152,39 @@` says the
 * old file's 152–176 and the new file's 152–190 are in the diff, and
 * everything outside is refused. This reads that out of the patch GitHub
 * already sends with each file, so the UI can offer the affordance only
 * where it will work rather than finding out at submit time.
 *
 * Pure: a patch string in, two sets of line numbers out.
 */

export interface Commentable {
  /** Lines of the head file that accept a comment (added and context). */
  right: Set<number>;
  /** Lines of the base file that accept a comment (removed and context). */
  left: Set<number>;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Read the commentable lines out of a unified diff. An absent patch — a
 * pure rename, or a file too large for GitHub to include — yields nothing,
 * which correctly offers no anchors rather than guessing at them.
 */
export function parsePatch(patch: string | undefined | null): Commentable {
  const right = new Set<number>();
  const left = new Set<number>();
  if (!patch) return { right, left };

  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split("\n")) {
    const hunk = raw.match(HUNK);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      continue;
    }
    if (!oldLine && !newLine) continue; // preamble before the first hunk

    // "\ No newline at end of file" annotates the line above and consumes
    // no line number of its own.
    if (raw.startsWith("\\")) continue;

    const kind = raw[0];
    if (kind === "+") {
      right.add(newLine++);
    } else if (kind === "-") {
      left.add(oldLine++);
    } else if (kind === " ") {
      // Context sits in both files and can be commented on either side.
      // A blank context line arrives as a single space, never as "" — a
      // zero-length entry is the trailing newline's split artifact, and
      // counting it walks both sides one line past the hunk.
      right.add(newLine++);
      left.add(oldLine++);
    }
  }

  return { right, left };
}

/**
 * The anchor for a block spanning `start`..`end` on one side: the first and
 * last of its lines that the diff will actually accept. Null when none of
 * them are in a hunk — the block is readable but not commentable.
 */
export function anchorFor(
  commentable: Commentable,
  side: "RIGHT" | "LEFT",
  start: number,
  end: number,
): { side: "RIGHT" | "LEFT"; line: number; startLine?: number } | null {
  const lines = side === "RIGHT" ? commentable.right : commentable.left;
  let first = 0;
  let last = 0;
  for (let n = start; n <= end; n++) {
    if (!lines.has(n)) continue;
    if (!first) first = n;
    last = n;
  }
  if (!first) return null;
  return first === last ? { side, line: last } : { side, line: last, startLine: first };
}
