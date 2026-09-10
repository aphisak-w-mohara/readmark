import { test, expect, describe } from "bun:test";
import { parsePatch, anchorFor } from "./patch";

const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

/** The shape GitHub actually sent for vercel/next.js#98353, trimmed. */
const REAL = [
  "@@ -152,6 +152,8 @@ and point it at your branch.",
  " ",
  " #### Running Deploy Tests Locally",
  " ",
  "-You can run deploy tests locally using `NEXT_TEST_VERSION`:",
  "+**Local Changes**",
  "+",
  "+By default, deploy tests use your checkout's packages:",
  " ",
].join("\n");

describe("parsePatch", () => {
  test("reads a single hunk's added and context lines", () => {
    const { right, left } = parsePatch(REAL);
    // new file: 152,153,154 context, 155-157 added, 158 context
    expect(sorted(right)).toEqual([152, 153, 154, 155, 156, 157, 158]);
    // old file: 152,153,154 context, 155 removed, 156 context
    expect(sorted(left)).toEqual([152, 153, 154, 155, 156]);
  });

  test("a line outside the hunk is not commentable", () => {
    const { right } = parsePatch(REAL);
    expect(right.has(151)).toBe(false);
    expect(right.has(300)).toBe(false);
  });

  test("follows several hunks independently", () => {
    const patch = [
      "@@ -1,2 +1,2 @@",
      "-old first",
      "+new first",
      " second",
      "@@ -50,1 +50,2 @@",
      " context",
      "+added",
    ].join("\n");
    const { right, left } = parsePatch(patch);
    expect(sorted(right)).toEqual([1, 2, 50, 51]);
    expect(sorted(left)).toEqual([1, 2, 50]);
  });

  test("a hunk header without a count is one line", () => {
    const { right, left } = parsePatch(["@@ -7 +7 @@", "-a", "+b"].join("\n"));
    expect(sorted(right)).toEqual([7]);
    expect(sorted(left)).toEqual([7]);
  });

  test("the no-newline marker consumes no line number", () => {
    const patch = ["@@ -1,1 +1,1 @@", "-a", "\\ No newline at end of file", "+b"].join("\n");
    const { right, left } = parsePatch(patch);
    expect(sorted(right)).toEqual([1]);
    expect(sorted(left)).toEqual([1]);
  });

  test("a blank context line is a single space, and advances both sides", () => {
    const { right } = parsePatch(["@@ -1,3 +1,3 @@", " a", " ", " c"].join("\n"));
    expect(sorted(right)).toEqual([1, 2, 3]);
  });

  // The trailing newline every patch ends with splits to "". Counting it
  // as context walks one line past the hunk and offers an anchor GitHub
  // will reject.
  test("the trailing newline does not add a line past the hunk", () => {
    const { right, left } = parsePatch("@@ -1,1 +1,1 @@\n-a\n+b\n");
    expect(sorted(right)).toEqual([1]);
    expect(sorted(left)).toEqual([1]);
  });

  test("the parsed span matches what the hunk header declares", () => {
    // @@ -152,25 +152,39 @@ means old 152..176 and new 152..190
    const body = [
      "@@ -152,25 +152,39 @@ heading",
      ...Array.from({ length: 25 }, (_, i) => (i < 12 ? " ctx" : "-old")),
      ...Array.from({ length: 14 }, () => "+new"),
      "",
    ].join("\n");
    const { right, left } = parsePatch(body);
    const span = (s: Set<number>) => {
      const a = sorted(s);
      return [a[0], a[a.length - 1], a.length];
    };
    expect(span(left)).toEqual([152, 176, 25]);
    expect(span(right)).toEqual([152, 177, 26]); // 12 context + 14 added
  });

  test("a missing patch yields nothing rather than guessing", () => {
    expect(sorted(parsePatch(undefined).right)).toEqual([]);
    expect(sorted(parsePatch("").left)).toEqual([]);
    expect(sorted(parsePatch("no hunks here").right)).toEqual([]);
  });
});

describe("anchorFor", () => {
  const c = parsePatch(REAL);

  test("a block inside the hunk anchors across its own range", () => {
    expect(anchorFor(c, "RIGHT", 155, 157)).toEqual({ side: "RIGHT", line: 157, startLine: 155 });
  });

  test("a single-line block carries no start", () => {
    expect(anchorFor(c, "RIGHT", 155, 155)).toEqual({ side: "RIGHT", line: 155 });
  });

  test("a block that only partly overlaps anchors to the overlap", () => {
    // 149-153: only 152 and 153 are in the hunk
    expect(anchorFor(c, "RIGHT", 149, 153)).toEqual({ side: "RIGHT", line: 153, startLine: 152 });
  });

  test("a block wholly outside the diff has no anchor", () => {
    expect(anchorFor(c, "RIGHT", 300, 320)).toBeNull();
    expect(anchorFor(c, "RIGHT", 1, 10)).toBeNull();
  });

  test("the two sides are separate", () => {
    // 157 is an added line: right only, never commentable on the left
    expect(anchorFor(c, "RIGHT", 157, 157)).toEqual({ side: "RIGHT", line: 157 });
    expect(anchorFor(c, "LEFT", 157, 157)).toBeNull();
  });

  test("a removed line anchors on the left", () => {
    expect(anchorFor(c, "LEFT", 155, 155)).toEqual({ side: "LEFT", line: 155 });
  });
});

/**
 * A commit range's patch is not the pull request's diff. GitHub validates a
 * review comment against the PR, so an anchor taken from a range can name a
 * line the PR does not have — measured on withastro/docs#5, where 3 of 22
 * files in one range offered exactly that. The app answers this by not
 * offering comments under a range at all; this test records why.
 */
describe("a range's patch is not the pull request's diff", () => {
  test("a range can show a line the whole PR does not", () => {
    // The PR as a whole only touches line 40 of the file…
    const prDiff = parsePatch(
      ["@@ -40,1 +40,1 @@", "-final wording", "+final wording v3"].join("\n"),
    );
    // …but one commit inside it also rewrote line 1, later reverted.
    const rangeDiff = parsePatch(
      [
        "@@ -1,1 +1,1 @@",
        "-title",
        "+title v2",
        "@@ -40,1 +40,1 @@",
        "-old",
        "+final wording v2",
      ].join("\n"),
    );
    expect(rangeDiff.right.has(1)).toBe(true);
    expect(prDiff.right.has(1)).toBe(false);
  });
});
