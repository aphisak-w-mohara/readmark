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

  // <span> is not raw text: the parser recovers from it on its own.
  test("an ordinary unclosed tag is not touched", () => {
    const src = "<p>a <span> b</p>";
    expect(sealDangling(src)).toBe(src);
  });
});
