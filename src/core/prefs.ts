/**
 * Reading preferences: defaults, coercion/validation, and persistence.
 * Storage is injected (real localStorage in the app, an in-memory fake in tests) —
 * that is the real seam here.
 */

import { type Option, THEMES, FONTS, SPACING, WIDTHS, SIZE_MIN, SIZE_MAX } from "./theme";

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

const KEY = "readmark-prefs";

/**
 * A pref the panel offers as a list may only hold a value still on that list.
 * Drop an option and whoever had picked it falls back to the default, rather
 * than keeping a value no button can show as selected.
 */
const oneOf = (opts: Option[], v: unknown, fallback: string) =>
  opts.some((o) => o.id === v) ? (v as string) : fallback;

/** Merge an untrusted object over the defaults, validating every field. */
export function coercePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    theme: oneOf(THEMES, r.theme, DEFAULT_PREFS.theme),
    font: oneOf(FONTS, r.font, DEFAULT_PREFS.font),
    size:
      typeof r.size === "number" && Number.isFinite(r.size)
        ? Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(r.size)))
        : DEFAULT_PREFS.size,
    spacing: oneOf(SPACING, r.spacing, DEFAULT_PREFS.spacing),
    width: oneOf(WIDTHS, r.width, DEFAULT_PREFS.width),
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
