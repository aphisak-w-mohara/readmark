/**
 * A review in progress: the comments you have written but not yet sent.
 *
 * Comments are keyed by where they land, so writing about a paragraph a
 * second time edits what you already said rather than stacking a duplicate
 * on the same line. The draft belongs to a pull request, not a file — you
 * review a document, and switching files mid-review is normal.
 *
 * Pure: values in, values out. The store holds one of these; the network
 * layer turns `reviewPayload` into a request.
 */

export type Side = "RIGHT" | "LEFT";

export interface Anchor {
  side: Side;
  line: number;
  startLine?: number;
}

export interface DraftComment extends Anchor {
  path: string;
  body: string;
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

/** Where a comment lands, as a string, so one anchor holds one comment. */
export function anchorKey(path: string, a: Anchor): string {
  return `${path}:${a.side}:${a.line}`;
}

/** Add a comment, or replace the one already on that anchor. */
export function putComment(
  draft: DraftComment[],
  path: string,
  anchor: Anchor,
  body: string,
): DraftComment[] {
  const key = anchorKey(path, anchor);
  const without = draft.filter((c) => anchorKey(c.path, c) !== key);
  const text = body.trim();
  if (!text) return without; // clearing the body removes the comment
  return [...without, { ...anchor, path, body: text }];
}

/** The comment on an anchor, if one has been written. */
export function commentAt(
  draft: DraftComment[],
  path: string,
  anchor: Anchor | null,
): DraftComment | null {
  if (!anchor) return null;
  const key = anchorKey(path, anchor);
  return draft.find((c) => anchorKey(c.path, c) === key) ?? null;
}

export function removeComment(draft: DraftComment[], path: string, anchor: Anchor): DraftComment[] {
  const key = anchorKey(path, anchor);
  return draft.filter((c) => anchorKey(c.path, c) !== key);
}

interface WireComment {
  path: string;
  line: number;
  side: Side;
  start_line?: number;
  start_side?: Side;
  body: string;
}

const wire = (c: DraftComment): WireComment => ({
  path: c.path,
  line: c.line,
  side: c.side,
  // Only sent for a real range: GitHub rejects a start equal to the line.
  ...(c.startLine && c.startLine !== c.line ? { start_line: c.startLine, start_side: c.side } : {}),
  body: c.body,
});

export interface ReviewPayload {
  commit_id: string;
  event: ReviewEvent;
  body?: string;
  comments: WireComment[];
}

/**
 * Why a review cannot be sent yet, or null when it can. GitHub requires a
 * summary for anything but an approval; saying so here beats letting the
 * API reject it after the round trip.
 */
export function whyNotSubmittable(event: ReviewEvent, summary: string): string | null {
  if (event === "APPROVE" || summary.trim()) return null;
  return event === "COMMENT"
    ? "A comment review needs a summary."
    : "Requesting changes needs a summary saying what to change.";
}

/** The body for POST /pulls/{n}/reviews. */
export function reviewPayload(
  commitId: string,
  event: ReviewEvent,
  summary: string,
  draft: DraftComment[],
): ReviewPayload {
  const body = summary.trim();
  return {
    commit_id: commitId,
    event,
    ...(body ? { body } : {}),
    comments: draft.map(wire),
  };
}

/** The body for POST /pulls/{n}/comments — one comment, sent on its own. */
export function commentPayload(
  commitId: string,
  path: string,
  anchor: Anchor,
  body: string,
): WireComment & { commit_id: string } {
  return { commit_id: commitId, ...wire({ ...anchor, path, body: body.trim() }) };
}
