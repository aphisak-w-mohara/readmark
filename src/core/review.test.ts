import { test, expect, describe } from "bun:test";
import {
  putComment,
  anchorKey,
  pendingPayload,
  submitPayload,
  commentPayload,
  type DraftComment,
} from "./review";

const R = (line: number, startLine?: number) =>
  ({ side: "RIGHT", line, ...(startLine ? { startLine } : {}) }) as const;

describe("the draft", () => {
  test("a comment is held against where it lands", () => {
    const d = putComment([], "a.md", R(3), "first thought");
    expect(d).toEqual([{ path: "a.md", side: "RIGHT", line: 3, body: "first thought" }]);
  });

  test("writing on the same anchor twice edits, never duplicates", () => {
    let d = putComment([], "a.md", R(3), "first");
    d = putComment(d, "a.md", R(3), "second");
    expect(d).toHaveLength(1);
    expect(d[0].body).toBe("second");
  });

  test("the same line on the other side is a different comment", () => {
    let d = putComment([], "a.md", R(3), "on the new text");
    d = putComment(d, "a.md", { side: "LEFT", line: 3 }, "on the old text");
    expect(d).toHaveLength(2);
  });

  test("the same line in another file is a different comment", () => {
    let d = putComment([], "a.md", R(3), "one");
    d = putComment(d, "b.md", R(3), "two");
    expect(d).toHaveLength(2);
  });

  test("clearing the body removes the comment", () => {
    let d = putComment([], "a.md", R(3), "said something");
    d = putComment(d, "a.md", R(3), "   ");
    expect(d).toEqual([]);
  });

  test("bodies are trimmed", () => {
    expect(putComment([], "a.md", R(3), "  padded  ")[0].body).toBe("padded");
  });

  test("a multi-line anchor keys on its last line, so the range can grow", () => {
    expect(anchorKey("a.md", R(9, 4))).toBe(anchorKey("a.md", R(9)));
  });

  test("clearing one comment leaves the others", () => {
    let d = putComment([], "a.md", R(3), "one");
    d = putComment(d, "a.md", R(9), "two");
    expect(putComment(d, "a.md", R(3), "")).toHaveLength(1);
  });
});

describe("the review payload", () => {
  const draft: DraftComment[] = [
    { path: "a.md", side: "RIGHT", line: 3, body: "single" },
    { path: "b.md", side: "RIGHT", line: 9, startLine: 4, body: "spanning" },
    { path: "c.md", side: "LEFT", line: 2, body: "on the old side" },
  ];

  test("the pending review carries the commit read and every comment", () => {
    const p = pendingPayload("headsha", draft);
    expect(p.commit_id).toBe("headsha");
    expect(p.comments).toHaveLength(3);
    // No event and no body: this call only parks the comments. Sending
    // them in one shot with a verdict is what would demand a summary.
    expect(p).not.toHaveProperty("event");
    expect(p).not.toHaveProperty("body");
  });

  test("start_line is sent only for a real range", () => {
    const p = pendingPayload("h", draft);
    expect(p.comments[0]).toEqual({ path: "a.md", line: 3, side: "RIGHT", body: "single" });
    expect(p.comments[1]).toEqual({
      path: "b.md",
      line: 9,
      side: "RIGHT",
      start_line: 4,
      start_side: "RIGHT",
      body: "spanning",
    });
  });

  test("a start equal to the line is not a range", () => {
    const p = pendingPayload("h", [
      { path: "a.md", side: "RIGHT", line: 5, startLine: 5, body: "x" },
    ]);
    expect(p.comments[0].start_line).toBeUndefined();
  });

  test("start_side follows the comment's own side", () => {
    const p = pendingPayload("h", [
      { path: "c.md", side: "LEFT", line: 8, startLine: 6, body: "x" },
    ]);
    expect(p.comments[0].start_side).toBe("LEFT");
  });

  test("a single comment carries the same shape plus the commit", () => {
    expect(commentPayload("h", "a.md", R(3), " hello ")).toEqual({
      commit_id: "h",
      path: "a.md",
      line: 3,
      side: "RIGHT",
      body: "hello",
    });
  });
});

describe("the verdict", () => {
  // GitHub requires a summary on a one-shot COMMENT or REQUEST_CHANGES
  // review. Submitting a review that already exists does not, so no
  // event has to be refused for want of one.
  test("an empty summary sends no body at all", () => {
    for (const e of ["COMMENT", "REQUEST_CHANGES", "APPROVE"] as const) {
      expect(submitPayload(e, "   ")).toEqual({ event: e });
    }
  });

  test("a summary is trimmed and sent", () => {
    expect(submitPayload("COMMENT", "  looks good  ")).toEqual({
      event: "COMMENT",
      body: "looks good",
    });
  });
});
