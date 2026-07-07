import { test, expect, describe } from "bun:test";
import { highlight } from "./highlight";

describe("highlight", () => {
  test("keywords, functions, numbers, strings in js", () => {
    const h = highlight('const x = fib(42); // hi\nlet s = "yo";', "js");
    expect(h).toContain('<span class="t-key">const</span>');
    expect(h).toContain('<span class="t-fn">fib</span>');
    expect(h).toContain('<span class="t-num">42</span>');
    expect(h).toContain('<span class="t-com">// hi</span>');
    expect(h).toContain('<span class="t-str">"yo"</span>'); // escapeHtml leaves quotes intact
  });

  test("string content is escaped inside tokens", () => {
    const h = highlight('x = "<b>"', "js");
    expect(h).toContain("&lt;b&gt;");
  });

  test("python uses # comments", () => {
    const h = highlight("def f(): # note\n  return 1", "py");
    expect(h).toContain('<span class="t-key">def</span>');
    expect(h).toContain('<span class="t-com"># note</span>');
  });

  test("language aliases resolve", () => {
    expect(highlight("const a=1", "javascript")).toContain('<span class="t-key">const</span>');
    expect(highlight("fn main(){}", "rs")).toContain('<span class="t-key">fn</span>');
  });

  test("unknown language escapes, no spans", () => {
    const h = highlight("<x> & 1", "brainfuck");
    expect(h).toBe("&lt;x&gt; &amp; 1");
    expect(h).not.toContain("<span");
  });
});
