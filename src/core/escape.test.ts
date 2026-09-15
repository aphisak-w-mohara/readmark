import { test, expect, describe } from "bun:test";
import { sealDangling } from "./escape";

/**
 * Each of these reaches the browser as "the rest of the document is my
 * body". The counts are what a real parser produced before the seal:
 * one <h1> where the document has two.
 */
describe("sealDangling", () => {
  const kept = '<h1 id="kept">Kept</h1>';
  const after = '<h1 id="after">After</h1>';

  test("an opener nothing closes is shown as text", () => {
    for (const dangling of [
      "<!-- oops",
      "<!-- a --> <!-- b",
      "<div> <!-- oops",
      "<pre>\n<!-- oops\n</pre>",
      "<p>Use the <style> element.</p>",
      "<p>Type into <textarea> to see.</p>",
      "<title>",
    ]) {
      const out = sealDangling(`${kept}\n${dangling}\n${after}`);
      expect(out).toContain("&lt;");
      expect(out).toContain(after);
    }
  });

  test("an opener that does close is left alone", () => {
    for (const closed of [
      "<!-- fine -->",
      "<style>.a { color: red }</style>",
      "<textarea>x</textarea>",
      "<details>\n<summary>s</summary>\n<p>body</p>\n</details>",
      "<pre>plain</pre>",
      "<p>ordinary prose</p>",
    ]) {
      const src = `${kept}\n${closed}\n${after}`;
      expect(sealDangling(src)).toBe(src);
    }
  });

  // The closer may be anywhere later in the document, not just adjacent.
  test("a closer further down the document still counts", () => {
    const src = `<style>\n${"filler\n".repeat(50)}</style>`;
    expect(sealDangling(src)).toBe(src);
  });

  // <plaintext> has no end tag in the tokenizer, so a literal
  // </plaintext> closes nothing and must not excuse the opener.
  test("a closer that closes nothing does not excuse <plaintext>", () => {
    expect(sealDangling("<plaintext></plaintext>")).toContain("&lt;plaintext");
  });

  // </style x> and </style/> are real end tags; sealing there would show
  // the stylesheet to the reader as text.
  test("an end tag carrying attributes still counts as a closer", () => {
    for (const close of ["</style x>", "</style/>", "</style >"]) {
      const src = `<style>.a{color:red}${close}`;
      expect(sealDangling(src)).toBe(src);
    }
  });

  // A longer name is a different tag, not a sloppy closer. A browser
  // keeps reading, so accepting these would excuse an opener nothing
  // closed — the page-blanking case, traded in for a cosmetic one.
  // \s is wider than the tokenizer's terminator set. A browser does not
  // close on these, so treating one as a closer excuses the opener and
  // the rest of the page becomes its body.
  test("a separator the tokenizer does not accept is not a closer", () => {
    for (const sep of ["\v", "\u00a0", "\u2028", "\u3000"]) {
      expect(sealDangling(`<style>.a{color:red}</style${sep}>`)).toContain("&lt;style");
    }
  });

  test("every separator the tokenizer does accept is a closer", () => {
    for (const sep of ["", " ", "\t", "\n", "\f", "\r", "/"]) {
      const src = `<style>.a{color:red}</style${sep}>`;
      expect(sealDangling(src)).toBe(src);
    }
  });

  test("a tag whose name merely starts the same is not a closer", () => {
    for (const close of ["</styleX>", "</style-x>", "</stylesheet>"]) {
      expect(sealDangling(`<style>.a{color:red}${close}`)).toContain("&lt;style");
    }
  });

  // <span> is not raw text: the parser recovers from it on its own.
  test("an ordinary unclosed tag is not touched", () => {
    const src = "<p>a <span> b</p>";
    expect(sealDangling(src)).toBe(src);
  });
});
