import { test, expect, describe } from "bun:test";
import {
  putComment,
  commentAt,
  anchorKey,
  reviewPayload,
  commentPayload,
  canSubmit,
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

  test("commentAt finds a comment by anchor, and nothing for null", () => {
    const d = putComment([], "a.md", R(3), "here");
    expect(commentAt(d, "a.md", R(3))?.body).toBe("here");
    expect(commentAt(d, "a.md", R(4))).toBeNull();
    expect(commentAt(d, "a.md", null)).toBeNull();
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

  test("carries the commit read, the event and every comment", () => {
    const p = reviewPayload("headsha", "APPROVE", "", draft);
    expect(p.commit_id).toBe("headsha");
    expect(p.event).toBe("APPROVE");
    expect(p.comments).toHaveLength(3);
    expect(p.body).toBeUndefined();
  });

  test("start_line is sent only for a real range", () => {
    const p = reviewPayload("h", "COMMENT", "summary", draft);
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
    const p = reviewPayload("h", "COMMENT", "s", [
      { path: "a.md", side: "RIGHT", line: 5, startLine: 5, body: "x" },
    ]);
    expect(p.comments[0].start_line).toBeUndefined();
  });

  test("start_side follows the comment's own side", () => {
    const p = reviewPayload("h", "COMMENT", "s", [
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

describe("whether it can be sent", () => {
  test("approving needs no summary", () => {
    expect(canSubmit("APPROVE", "")).toBe(true);
  });

  test("commenting and requesting changes both need one", () => {
    expect(canSubmit("COMMENT", "  ")).toBe(false);
    expect(canSubmit("REQUEST_CHANGES", "")).toBe(false);
  });

  test("with a summary, both are fine", () => {
    expect(canSubmit("COMMENT", "looks good")).toBe(true);
    expect(canSubmit("REQUEST_CHANGES", "please fix")).toBe(true);
  });
});
