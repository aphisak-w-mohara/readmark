import { test, expect, describe } from "bun:test";
import { tokenize, wordDiff, toDiffHtml } from "./diff";
import { toHtml } from "./markdown";

const DEL = "\u0004";
const DEL_END = "\u0005";
const INS = "\u0006";
const INS_END = "\u0007";

const SAMPLE = [
  "# Readmark",
  "",
  "An elegant reader. Paste Markdown or point it at a [GitHub](https://github.com) URL.",
  "",
  "## Quick start",
  "",
  "```bash",
  "bun install",
  "bun run dev",
  "```",
  "",
  "- swappable paper themes",
  "- real typefaces",
  "",
  "> No server, no CDN, no tracking.",
  "",
  "| key | value |",
  "| --- | ----- |",
  "| a   | 1     |",
].join("\n");

describe("tokenize", () => {
  test("keeps a link whole", () => {
    expect(tokenize("see [the docs](https://x.dev/a_b) now")).toContain(
      "[the docs](https://x.dev/a_b)",
    );
  });

  test("keeps inline code and images whole", () => {
    expect(tokenize("`a b` and ![alt](i.png)")).toEqual([
      "`a b`",
      " ",
      "and",
      " ",
      "![alt](i.png)",
    ]);
  });

  test("round-trips exactly", () => {
    const s = "Mixed **text**, a [link](http://a.b), `code`, and  spacing.";
    expect(tokenize(s).join("")).toBe(s);
  });
});

describe("wordDiff", () => {
  test("marks only the words that changed", () => {
    const out = wordDiff("five paper themes", "six paper themes");
    expect(out).toBe(`${DEL}five${DEL_END}${INS}six${INS_END} paper themes`);
  });

  test("never splits inside a link", () => {
    const out = wordDiff("see [docs](http://a.b) now", "see [guide](http://c.d) now");
    expect(out).toBe(
      `see ${DEL}[docs](http://a.b)${DEL_END}${INS}[guide](http://c.d)${INS_END} now`,
    );
  });

  test("a pure insertion has no delete marker", () => {
    expect(wordDiff("a c", "a b c")).toBe(`a ${INS}b ${INS_END}c`);
  });

  test("sentinel characters in the input cannot forge a marker", () => {
    const hostile = `plain ${INS}fake${INS_END} text`;
    expect(wordDiff(hostile, hostile)).toBe("plain fake text");
  });

  test("identical input produces no markers at all", () => {
    expect(wordDiff(SAMPLE, SAMPLE)).toBe(SAMPLE);
  });
});

describe("toDiffHtml", () => {
  test("diffing a document against itself renders exactly toHtml", () => {
    const plain = toHtml(SAMPLE);
    const diffed = toDiffHtml(SAMPLE, SAMPLE);
    expect(diffed.rows.map((r) => r.unified).join("\n")).toBe(plain.html);
    expect(diffed.counts).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(diffed.rows.every((r) => r.op === "same")).toBe(true);
  });

  test("a rewrapped paragraph produces no marks", () => {
    const a = "one two three\nfour five six";
    const b = "one two\nthree four five six";
    const d = toDiffHtml(a, b);
    expect(d.counts.changed).toBe(0);
    expect(d.rows[0].unified).not.toContain("<ins");
  });

  test("a three-word edit marks three words and nothing else", () => {
    const a = "The reader shows swappable paper themes and an auto outline.";
    const b = "The reader shows five paper themes and a live outline.";
    const html = toDiffHtml(a, b).rows[0].unified;
    expect(html).toContain('<del class="diff-del">swappable</del>');
    expect(html).toContain('<ins class="diff-ins">five</ins>');
    expect(html).toContain("paper themes and");
    expect(html).not.toContain("<del>The</del>");
  });

  test("marks survive inline formatting and links", () => {
    const html = toDiffHtml(
      "read the [old docs](http://a.b) carefully",
      "read the [new docs](http://a.b) carefully",
    ).rows[0].unified;
    expect(html).toContain('<a href="http://a.b"');
    expect(html).toContain("new docs");
    expect(html).toContain('<del class="diff-del">');
  });

  test("added and removed blocks are whole-block rows", () => {
    const d = toDiffHtml("# T\n\nkeep\n\ngone", "# T\n\nkeep\n\nfresh block here");
    expect(d.rows.map((r) => r.op)).toEqual(["same", "same", "removed", "added"]);
    expect(d.rows[2].after).toBe("");
    expect(d.rows[3].before).toBe("");
    expect(d.counts).toEqual({ added: 1, removed: 1, changed: 0 });
  });

  test("a changed code block is shown whole, not word-marked", () => {
    const d = toDiffHtml("```js\nconst a = 1;\n```", "```js\nconst a = 2;\n```");
    expect(d.rows[0].op).toBe("changed");
    expect(d.rows[0].marked).toBe(false);
    expect(d.rows[0].unified).not.toContain("<ins");
  });

  test("a heading keeps its structure while its words are marked", () => {
    const html = toDiffHtml("## Quick start", "## Fast start").rows[0].unified;
    expect(html).toMatch(/^<h2 id="fast-start">/);
    expect(html).toContain('<ins class="diff-ins">Fast</ins>');
  });

  test("a heading level change is flagged without breaking the outline id", () => {
    const d = toDiffHtml("## Quick start", "### Quick start");
    expect(d.rows[0].op).toBe("changed");
    expect(d.headings[0].id).toBe("quick-start");
    expect(d.headings[0].changed).toBe(true);
  });

  test("a heading is flagged when a block under it changes", () => {
    const d = toDiffHtml(
      "# A\n\nuntouched\n\n## B\n\nold words",
      "# A\n\nuntouched\n\n## B\n\nnew words entirely",
    );
    expect(d.headings.map((h) => [h.text, h.changed])).toEqual([
      ["A", false],
      ["B", true],
    ]);
  });

  test("split columns hold each side on its own", () => {
    const d = toDiffHtml("only before", "only after");
    const [row] = d.rows;
    expect(row.before).toContain("only before");
    expect(row.after).toContain("only after");
  });
});
