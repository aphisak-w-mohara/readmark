import { test, expect, describe } from "bun:test";
import { coercePrefs, loadPrefs, savePrefs, DEFAULT_PREFS, type StorageLike } from "./prefs";

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

  test("rejects unknown theme/font, keeps valid ones", () => {
    expect(coercePrefs({ theme: "hacker" }).theme).toBe("original");
    expect(coercePrefs({ theme: "night" }).theme).toBe("night");
    expect(coercePrefs({ font: "comic" }).font).toBe("newyork");
    expect(coercePrefs({ font: "charter" }).font).toBe("charter");
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
    expect(loadPrefs(memStorage({ "codex-prefs": "{not json" }))).toEqual(DEFAULT_PREFS);
  });
});
