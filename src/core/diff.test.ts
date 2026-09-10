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
    expect(wordDiff("a c", "a b c")).toBe(`a ${INS}b${INS_END} c`);
  });

  test("a mark never spans the whitespace at its edges", () => {
    const out = wordDiff("one two\nthree", "one four\nthree");
    expect(out).toBe(`one ${DEL}two${DEL_END}${INS}four${INS_END}\nthree`);
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
    expect(row.before).toBe('<p>only <del class="diff-del">before</del></p>');
    expect(row.after).toBe('<p>only <ins class="diff-ins">after</ins></p>');
  });
});

describe("outline integrity", () => {
  test("a removed heading does not shift the outline", () => {
    const d = toDiffHtml("# A\n\n## Gone\n\nbody\n\n## B\n\ntail", "# A\n\n## B\n\ntail");
    expect(d.headings.map((h) => h.text)).toEqual(["A", "B"]);
    expect(d.headings.map((h) => h.id)).toEqual(["a", "b"]);
  });

  test("the split view's before column carries no ids", () => {
    const d = toDiffHtml("## Quick start\n\nold", "## Quick start\n\nnew");
    expect(d.rows[0].after).toContain('id="quick-start"');
    expect(d.rows[0].before).not.toContain("id=");
  });
});

describe("rewrapping", () => {
  const BEFORE = [
    "An elegant, iOS-Books-style Markdown reader. Paste Markdown",
    "or point it at a GitHub URL, then read it your way — swappable",
    "paper themes, real typefaces, and an auto outline.",
  ].join("\n");
  const AFTER = [
    "An elegant, iOS-Books-style Markdown reader. Paste Markdown or point it at a GitHub URL,",
    "then read it your way — five paper themes, real typefaces, and a live outline.",
  ].join("\n");

  test("a rewrap that also edits words still marks the words", () => {
    const row = toDiffHtml(BEFORE, AFTER).rows[0];
    expect(row.op).toBe("changed");
    expect(row.marked).toBe(true);
    expect(row.unified).toContain('<del class="diff-del">swappable</del>');
    expect(row.unified).toContain('<ins class="diff-ins">five</ins>');
    expect(row.unified).toContain('<ins class="diff-ins">live</ins>');
  });

  test("and marks nothing else in the paragraph", () => {
    const row = toDiffHtml(BEFORE, AFTER).rows[0];
    // swappable→five, an→a, auto→live: three runs, not one smeared block
    expect(row.unified.match(/<ins /g) ?? []).toHaveLength(3);
    expect(row.unified.match(/<del /g) ?? []).toHaveLength(3);
    expect(row.unified).toContain("paper themes, real typefaces");
  });
});

describe("split columns", () => {
  test("each side marks only its own half of the edit", () => {
    const row = toDiffHtml("five paper themes", "six paper themes").rows[0];
    expect(row.before).toContain('<del class="diff-del">five</del>');
    expect(row.before).not.toContain("<ins");
    expect(row.before).not.toContain("six");
    expect(row.after).toContain('<ins class="diff-ins">six</ins>');
    expect(row.after).not.toContain("<del");
    expect(row.after).not.toContain("five");
  });

  test("an unmarkable change still shows each side plainly", () => {
    const row = toDiffHtml("```js\nlet a = 1;\n```", "```js\nlet a = 2;\n```").rows[0];
    expect(row.before).toContain("let a = 1;");
    expect(row.after).toContain("let a = 2;");
    expect(row.before).not.toContain("<del");
  });
});
