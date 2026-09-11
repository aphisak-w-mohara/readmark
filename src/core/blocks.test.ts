import { test, expect, describe } from "bun:test";
import { splitBlocks, fenceParts, normalize, stripInline } from "./blocks";

const kinds = (src: string) => splitBlocks(src).map((b) => b.kind);
const keys = (src: string) => splitBlocks(src).map((b) => b.text);

describe("splitBlocks", () => {
  test("a fenced block with blank lines inside stays one block", () => {
    const src = "para\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nafter";
    expect(kinds(src)).toEqual(["para", "code", "para"]);
    expect(fenceParts(splitBlocks(src)[1].src).body).toBe("const a = 1;\n\nconst b = 2;");
  });

  test("an unterminated fence still yields one code block", () => {
    const { lang, body } = fenceParts(splitBlocks("```py\nx = 1\ny = 2")[0].src);
    expect(lang).toBe("py");
    expect(body).toBe("x = 1\ny = 2");
  });

  test("a nested list is one block, not one per item", () => {
    const src = "- one\n  - nested\n  - also\n- two\n\ntail";
    expect(kinds(src)).toEqual(["list", "para"]);
  });

  test("tables, setext headings, hr and raw html each split out", () => {
    const src = [
      "Title",
      "=====",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "---",
      "",
      "<details>",
      "<summary>more</summary>",
      "</details>",
    ].join("\n");
    expect(kinds(src)).toEqual(["heading", "table", "hr", "html"]);
  });

  test("line numbers are 1-based and survive blank runs", () => {
    const src = "# h\n\n\npara one\n\n- item";
    expect(splitBlocks(src).map((b) => b.line)).toEqual([1, 4, 6]);
  });

  test("a blockquote is one block and keeps its markers in src", () => {
    const b = splitBlocks("> quoted\n> lines")[0];
    expect(b.kind).toBe("quote");
    expect(b.src).toBe("> quoted\n> lines");
    expect(b.text).toBe("quoted lines");
  });
});

describe("alignment keys", () => {
  test("rewrapping a paragraph does not change its key", () => {
    const hard =
      "Readmark is a reader. Paste Markdown\nor point it at a URL, then read\nit your way.";
    const soft =
      "Readmark is a reader. Paste Markdown or point it at a URL,\nthen read it your way.";
    expect(keys(hard)).toEqual(keys(soft));
  });

  test("changing words does change the key", () => {
    expect(keys("five paper themes")).not.toEqual(keys("swappable paper themes"));
  });

  test("inline markup is not part of the key", () => {
    expect(keys("a **bold** word")).toEqual(keys("a bold word"));
  });

  test("code keeps its indentation in the key", () => {
    expect(keys("```\n  indented\n```")).not.toEqual(keys("```\nindented\n```"));
  });

  test("ordered and unordered lists key differently", () => {
    expect(keys("- one\n- two")).not.toEqual(keys("1. one\n2. two"));
  });

  test("heading level is not part of the key", () => {
    expect(keys("## Quick start")).toEqual(keys("### Quick start"));
  });
});

describe("helpers", () => {
  test("stripInline removes code, emphasis and links", () => {
    expect(stripInline("`a` **b** _c_ [d](http://e)")).toBe("a b c d");
  });

  test("normalize collapses whitespace", () => {
    expect(normalize("  a\n\t b  ")).toBe("a b");
  });
});

describe("raw HTML containers", () => {
  // Ending an HTML block at the first blank line splits <details> from its
  // contents. Rendered as one row per block, the element then closes at the
  // row boundary and the accordion never toggles.
  const DETAILS = [
    "<details>",
    "<summary>Version history</summary>",
    "",
    "| Version | Date |",
    "| --- | --- |",
    "| 1.0 | today |",
    "",
    "</details>",
  ].join("\n");

  test("a container survives the blank lines inside it", () => {
    const blocks = splitBlocks(DETAILS);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("html");
    expect(blocks[0].src).toContain("</details>");
  });

  test("nesting the same tag does not close early", () => {
    const src = ["<div>", "<div>", "", "inner", "", "</div>", "", "tail", "</div>"].join("\n");
    expect(splitBlocks(src)).toHaveLength(1);
  });

  test("an unclosed container falls back to the blank-line rule", () => {
    const src = ["<div>", "dangling", "", "# A separate heading"].join("\n");
    expect(splitBlocks(src).map((b) => b.kind)).toEqual(["html", "heading"]);
  });

  test("a void element is not treated as a container", () => {
    expect(splitBlocks(["<hr/>", "", "after"].join("\n")).map((b) => b.kind)).toEqual([
      "html",
      "para",
    ]);
  });

  test("a self-closing tag ends its own block", () => {
    expect(splitBlocks(['<img src="a.png" />', "", "after"].join("\n"))).toHaveLength(2);
  });
});
