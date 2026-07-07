/**
 * Reading preferences: defaults, coercion/validation, and persistence.
 * Storage is injected (real localStorage in the app, an in-memory fake in tests) —
 * that is the real seam here.
 */

export interface Prefs {
  theme: string;
  font: string;
  size: number;
  spacing: string;
  width: string;
  outline: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_PREFS: Prefs = {
  theme: "original",
  font: "newyork",
  size: 19,
  spacing: "1.66",
  width: "66ch",
  outline: true,
};

const THEMES = new Set(["original", "quiet", "sepia", "night", "black"]);
const FONTS = new Set(["newyork", "charter", "georgia", "palatino", "avenir", "system"]);
const SIZE_MIN = 14;
const SIZE_MAX = 30;
const KEY = "codex-prefs";

/** Merge an untrusted object over the defaults, validating every field. */
export function coercePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
  const size =
    typeof r.size === "number" && Number.isFinite(r.size)
      ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(r.size)))
      : DEFAULT_PREFS.size;
  const theme = str(r.theme, DEFAULT_PREFS.theme);
  const font = str(r.font, DEFAULT_PREFS.font);
  return {
    theme: THEMES.has(theme) ? theme : DEFAULT_PREFS.theme,
    font: FONTS.has(font) ? font : DEFAULT_PREFS.font,
    size,
    spacing: str(r.spacing, DEFAULT_PREFS.spacing),
    width: str(r.width, DEFAULT_PREFS.width),
    outline: typeof r.outline === "boolean" ? r.outline : DEFAULT_PREFS.outline,
  };
}

/** Load and validate prefs from storage; defaults on any error. */
export function loadPrefs(storage: StorageLike): Prefs {
  try {
    return coercePrefs(JSON.parse(storage.getItem(KEY) || "{}"));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Persist prefs; swallows storage errors (private mode, quota). */
export function savePrefs(storage: StorageLike, prefs: Prefs): void {
  try {
    storage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
