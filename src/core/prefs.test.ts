import { test, expect, describe } from "bun:test";
import { coercePrefs, loadPrefs, savePrefs, DEFAULT_PREFS, type StorageLike } from "./prefs";
import { THEMES, FONTS, SPACING, WIDTHS } from "./theme";

function memStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("coercePrefs", () => {
  test("empty -> defaults", () => {
    expect(coercePrefs({})).toEqual(DEFAULT_PREFS);
    expect(coercePrefs(null)).toEqual(DEFAULT_PREFS);
  });

  test("clamps size to 14..30 and rounds", () => {
    expect(coercePrefs({ size: 99 }).size).toBe(30);
    expect(coercePrefs({ size: 2 }).size).toBe(14);
    expect(coercePrefs({ size: 20.6 }).size).toBe(21);
  });

  test("rejects a value the panel does not offer, keeps one it does", () => {
    expect(coercePrefs({ theme: "hacker" }).theme).toBe("original");
    expect(coercePrefs({ theme: "night" }).theme).toBe("night");
    expect(coercePrefs({ font: "comic" }).font).toBe("newyork");
    expect(coercePrefs({ font: "charter" }).font).toBe("charter");
    // "82ch" was the old "Wide" — a dropped option must not survive a reload,
    // or the panel shows a width with no button selected.
    expect(coercePrefs({ width: "82ch" }).width).toBe(DEFAULT_PREFS.width);
    expect(coercePrefs({ width: "104ch" }).width).toBe("104ch");
    expect(coercePrefs({ spacing: "9" }).spacing).toBe(DEFAULT_PREFS.spacing);
    expect(coercePrefs({ spacing: "1.95" }).spacing).toBe("1.95");
  });

  test("every offered option survives a round-trip", () => {
    for (const w of WIDTHS) expect(coercePrefs({ width: w.id }).width).toBe(w.id);
    for (const s of SPACING) expect(coercePrefs({ spacing: s.id }).spacing).toBe(s.id);
    for (const t of THEMES) expect(coercePrefs({ theme: t.id }).theme).toBe(t.id);
    for (const f of FONTS) expect(coercePrefs({ font: f.id }).font).toBe(f.id);
  });

  test("wrong types fall back", () => {
    const p = coercePrefs({ outline: "yes", spacing: 5 });
    expect(p.outline).toBe(true);
    expect(p.spacing).toBe(DEFAULT_PREFS.spacing);
  });
});

describe("persistence", () => {
  test("save then load round-trips", () => {
    const s = memStorage();
    const prefs = { ...DEFAULT_PREFS, theme: "sepia", size: 24, outline: false };
    savePrefs(s, prefs);
    expect(loadPrefs(s)).toEqual(prefs);
  });

  test("missing key -> defaults", () => {
    expect(loadPrefs(memStorage())).toEqual(DEFAULT_PREFS);
  });

  test("corrupt json -> defaults", () => {
    expect(loadPrefs(memStorage({ "readmark-prefs": "{not json" }))).toEqual(DEFAULT_PREFS);
  });
});
