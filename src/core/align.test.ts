import { test, expect, describe } from "bun:test";
import { splitBlocks } from "./blocks";
import { align, similarity } from "./align";

const ops = (a: string, b: string) => align(splitBlocks(a), splitBlocks(b)).map((c) => c.op);

const PARA_HARD = [
  "Readmark is an elegant, iOS-Books-style Markdown reader. Paste Markdown",
  "or point it at a GitHub URL, then read it your way — swappable paper",
  "themes, real typefaces, and an auto outline.",
].join("\n");

const PARA_SOFT = [
  "Readmark is an elegant, iOS-Books-style Markdown reader. Paste Markdown or point",
  "it at a GitHub URL, then read it your way — swappable paper themes, real",
  "typefaces, and an auto outline.",
].join("\n");

const PARA_EDITED = [
  "Readmark is an elegant, iOS-Books-style Markdown reader. Paste Markdown or point",
  "it at a GitHub URL, then read it your way — five paper themes, real typefaces,",
  "and a live outline.",
].join("\n");

describe("align", () => {
  test("rewrapping a paragraph is not a change", () => {
    expect(ops(PARA_HARD, PARA_SOFT)).toEqual(["same"]);
  });

  test("three words edited inside a rewrapped paragraph is exactly one change", () => {
    expect(ops(PARA_HARD, PARA_EDITED)).toEqual(["changed"]);
  });

  test("an identical document is all same", () => {
    const doc = "# Title\n\npara one\n\n- a\n- b\n\n```js\nx\n```";
    expect(ops(doc, doc)).toEqual(["same", "same", "same", "same"]);
  });

  test("inserting a block at the top does not cascade", () => {
    const before = "# Title\n\none\n\ntwo\n\nthree";
    const after = "# Title\n\nzero\n\none\n\ntwo\n\nthree";
    expect(ops(before, after)).toEqual(["same", "added", "same", "same", "same"]);
  });

  test("deleting a block in the middle touches nothing else", () => {
    const before = "# Title\n\none\n\ntwo\n\nthree";
    const after = "# Title\n\none\n\nthree";
    expect(ops(before, after)).toEqual(["same", "same", "removed", "same"]);
  });

  test("emphasis added to otherwise identical text is a change, not a match", () => {
    expect(ops("a bold word here", "a **bold** word here")).toEqual(["changed"]);
  });

  test("a heading level change is a change", () => {
    expect(ops("## Quick start", "### Quick start")).toEqual(["changed"]);
  });

  test("unrelated blocks of different kinds do not pair up", () => {
    expect(ops("- a list item", "a paragraph entirely").sort()).toEqual(["added", "removed"]);
  });

  test("a wholly rewritten paragraph is a remove plus an add, not a change", () => {
    const ops2 = ops("The cat sat on the mat.", "Deployment requires two secrets.");
    expect(ops2.sort()).toEqual(["added", "removed"]);
  });

  test("order is preserved across mixed edits", () => {
    const before = "# T\n\nkeep me\n\nedit me slightly here\n\ndrop me";
    const after = "# T\n\nkeep me\n\nedit me a lot here\n\nbrand new tail block";
    expect(ops(before, after)).toEqual(["same", "same", "changed", "removed", "added"]);
  });
});

describe("similarity", () => {
  test("identical strings score 1", () => {
    expect(similarity("a b c", "a b c")).toBe(1);
  });

  test("disjoint strings score 0", () => {
    expect(similarity("a b", "c d")).toBe(0);
  });

  test("a small edit stays high", () => {
    expect(similarity("the quick brown fox", "the quick red fox")).toBeGreaterThan(0.7);
  });
});
