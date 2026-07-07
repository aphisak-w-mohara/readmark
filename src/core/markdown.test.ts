import { test, expect, describe } from "bun:test";
import { toHtml } from "./markdown";

describe("toHtml", () => {
  test("headings produce ids, outline, and title", () => {
    const r = toHtml("# Title\n\n## Section A\n\n### Deep");
    expect(r.title).toBe("Title");
    expect(r.headings.map((h) => [h.level, h.text, h.id])).toEqual([
      [1, "Title", "title"],
      [2, "Section A", "section-a"],
      [3, "Deep", "deep"],
    ]);
    expect(r.html).toContain('<h1 id="title">Title</h1>');
  });

  test("duplicate heading text gets de-duplicated ids", () => {
    const r = toHtml("## Notes\n\n## Notes");
    expect(r.headings.map((h) => h.id)).toEqual(["notes", "notes-1"]);
  });

  test("title strips inline markdown", () => {
    expect(toHtml("# Hello **World**").title).toBe("Hello World");
  });

  test("no h1 means Untitled", () => {
    expect(toHtml("## just a section").title).toBe("Untitled");
  });

  test("inline code does not corrupt numbers in prose", () => {
    // regression: the placeholder sentinel must not match real digits
    const r = toHtml("The answer is 42 and `code` is 7.");
    expect(r.html).toContain("The answer is 42 and <code>code</code> is 7.");
    expect(r.html).not.toContain(String.fromCharCode(1)); // no leftover sentinel
  });

  test("emphasis, strong, strike, links", () => {
    const r = toHtml("*em* **strong** ~~gone~~ [x](https://a.com)");
    expect(r.html).toContain("<em>em</em>");
    expect(r.html).toContain("<strong>strong</strong>");
    expect(r.html).toContain("<del>gone</del>");
    expect(r.html).toContain('<a href="https://a.com" target="_blank" rel="noopener">x</a>');
  });

  test("javascript: urls are neutralised", () => {
    const r = toHtml("[click](javascript:alert(1))");
    expect(r.html).toContain('href="#"');
    expect(r.html).not.toContain("javascript:");
  });

  test("recognized HTML tags pass through raw (the view layer's DOMPurify removes dangerous ones)", () => {
    const r = toHtml("a <script>evil()</script> b");
    expect(r.html).toContain("<script>evil()</script>");
  });

  test("nested + task lists", () => {
    const r = toHtml("- a\n    - [x] done\n    - [ ] todo");
    expect(r.html).toContain("<ul><li>a<ul>");
    expect(r.html).toContain('<li class="task"><input type="checkbox" disabled checked>');
    expect(r.html).toContain('<input type="checkbox" disabled> ');
  });

  test("ordered lists", () => {
    const r = toHtml("1. one\n2. two");
    expect(r.html).toContain("<ol><li>one</li><li>two</li></ol>");
  });

  test("tables with alignment", () => {
    const r = toHtml("| A | B |\n| :- | -: |\n| 1 | 2 |");
    expect(r.html).toContain('<div class="table-wrap">');
    expect(r.html).toContain('<th align="left">A</th>');
    expect(r.html).toContain('<td align="right">2</td>');
  });

  test("blockquote and hr", () => {
    expect(toHtml("> quoted").html).toContain("<blockquote><p>quoted</p></blockquote>");
    expect(toHtml("---").html).toBe("<hr>");
  });

  test("injected highlighter is called for fenced code", () => {
    const calls: Array<[string, string]> = [];
    const fake = (code: string, lang: string) => {
      calls.push([code, lang]);
      return "HL:" + lang;
    };
    const r = toHtml("```js\nlet x=1;\n```", { highlight: fake });
    expect(calls).toEqual([["let x=1;", "js"]]);
    expect(r.html).toContain('<span class="codelang">js</span>');
    expect(r.html).toContain("<code>HL:js</code>");
  });

  test("default highlighter escapes code untouched", () => {
    const r = toHtml("```\n<b> & 1\n```");
    expect(r.html).toContain("&lt;b&gt; &amp; 1");
  });

  test("angle-bracket autolinks", () => {
    const r = toHtml("see <https://example.com/x> now");
    expect(r.html).toContain(
      '<a href="https://example.com/x" target="_blank" rel="noopener">https://example.com/x</a>',
    );
  });

  test("reference-style links (full, collapsed, shortcut)", () => {
    const r = toHtml('[full][id] and [id][] and [id]\n\n[id]: https://ref.example "T"');
    // definition line is consumed, not rendered
    expect(r.html).not.toContain("https://ref.example &quot;T&quot;");
    expect(r.html).toContain(
      '<a href="https://ref.example" title="T" target="_blank" rel="noopener">full</a>',
    );
    expect(r.html).toContain(
      '<a href="https://ref.example" title="T" target="_blank" rel="noopener">id</a>',
    );
  });

  test("unresolved reference brackets are left as text", () => {
    const r = toHtml("this [is not] a link");
    expect(r.html).toContain("this [is not] a link");
  });

  test("mermaid fence becomes a diagram placeholder, not a code block", () => {
    const r = toHtml("```mermaid\ngraph TD; A-->B;\n```");
    expect(r.html).toContain(
      '<div class="mermaid"><pre class="mermaid-src">graph TD; A--&gt;B;</pre></div>',
    );
    expect(r.html).not.toContain("codeblock");
  });

  test("block-level raw HTML passes through with markdown inside", () => {
    const r = toHtml("<details>\n<summary>More</summary>\n\n- one\n- two\n\n</details>");
    expect(r.html).toContain("<details>");
    expect(r.html).toContain("<summary>More</summary>");
    expect(r.html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(r.html).toContain("</details>");
  });

  test("inline HTML tags pass through", () => {
    expect(toHtml("press <kbd>Esc</kbd> to exit").html).toContain("press <kbd>Esc</kbd> to exit");
  });

  test("stray < that is not a tag is escaped", () => {
    expect(toHtml("if a < b and c < d").html).toContain("if a &lt; b and c &lt; d");
  });

  test("raw HTML passes through unsanitized (view layer sanitizes it)", () => {
    expect(toHtml("<b>bold html</b>").html).toContain("<b>bold html</b>");
  });
});
