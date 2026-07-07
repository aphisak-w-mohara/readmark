import { test, expect, describe } from "bun:test";
import { countWords, readingTime, progressPct, activeHeadingId, focusTargetIndex } from "./reading";

describe("reading metrics", () => {
  test("countWords", () => {
    expect(countWords("  one  two\nthree ")).toBe(3);
    expect(countWords("   ")).toBe(0);
  });

  test("readingTime floors at 1 minute", () => {
    expect(readingTime(0)).toBe(1);
    expect(readingTime(220)).toBe(1);
    expect(readingTime(660)).toBe(3);
  });

  test("progressPct clamps 0..100", () => {
    expect(progressPct(0, 1000, 500)).toBe(0);
    expect(progressPct(250, 1000, 500)).toBe(50);
    expect(progressPct(9999, 1000, 500)).toBe(100);
    expect(progressPct(0, 400, 500)).toBe(0); // nothing to scroll
  });

  test("activeHeadingId picks the last heading above the probe", () => {
    const hs = [
      { id: "a", top: 0 },
      { id: "b", top: 500 },
      { id: "c", top: 1200 },
    ];
    expect(activeHeadingId(hs, -10)).toBeNull();
    expect(activeHeadingId(hs, 100)).toBe("a");
    expect(activeHeadingId(hs, 600)).toBe("b");
    expect(activeHeadingId(hs, 5000)).toBe("c");
    expect(activeHeadingId([], 100)).toBeNull();
  });

  test("focusTargetIndex finds nearest center", () => {
    expect(focusTargetIndex([100, 300, 700], 320)).toBe(1);
    expect(focusTargetIndex([100, 300, 700], 690)).toBe(2);
    expect(focusTargetIndex([], 5)).toBe(-1);
  });
});
