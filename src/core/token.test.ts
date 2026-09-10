import { test, expect, describe } from "bun:test";
import {
  validateToken,
  loadToken,
  saveToken,
  clearToken,
  isRemembered,
  type TokenStore,
  type TokenStores,
} from "./token";

const fakeStore = (): TokenStore => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};
const stores = (): TokenStores => ({ session: fakeStore(), local: fakeStore() });

const FINE = "github_pat_" + "A".repeat(30);
const CLASSIC = "ghp_" + "B".repeat(36);
const OAUTH = "gho_" + "C".repeat(36);

describe("validateToken", () => {
  test("accepts the three shapes GitHub issues", () => {
    expect(validateToken(FINE)).toMatchObject({ ok: true, kind: "fine-grained" });
    expect(validateToken(CLASSIC)).toMatchObject({ ok: true, kind: "classic" });
    expect(validateToken(OAUTH)).toMatchObject({ ok: true, kind: "oauth" });
  });

  test("trims surrounding whitespace from a paste", () => {
    expect(validateToken(`  ${FINE}\n`)).toMatchObject({ ok: true, token: FINE });
  });

  test("rejects empty, spaced, truncated and URL input", () => {
    expect(validateToken("")).toMatchObject({ ok: false });
    expect(validateToken("ghp_ab cd")).toMatchObject({ ok: false });
    expect(validateToken("ghp_short")).toMatchObject({ ok: false });
    expect(validateToken("https://github.com/o/r/pull/1")).toMatchObject({ ok: false });
  });

  test("says what it expected when the shape is wrong", () => {
    const r = validateToken("nonsense");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.msg).toContain("github_pat_");
  });
});

describe("token storage", () => {
  test("defaults to the session store", () => {
    const s = stores();
    saveToken(s, FINE, false);
    expect(s.session.getItem("readmark-gh-token")).toBe(FINE);
    expect(s.local.getItem("readmark-gh-token")).toBeNull();
    expect(isRemembered(s)).toBe(false);
    expect(loadToken(s)).toBe(FINE);
  });

  test("remember puts it in the local store instead, not as well", () => {
    const s = stores();
    saveToken(s, FINE, true);
    expect(s.local.getItem("readmark-gh-token")).toBe(FINE);
    expect(s.session.getItem("readmark-gh-token")).toBeNull();
    expect(isRemembered(s)).toBe(true);
  });

  test("switching remember off does not leave the old copy behind", () => {
    const s = stores();
    saveToken(s, FINE, true);
    saveToken(s, CLASSIC, false);
    expect(s.local.getItem("readmark-gh-token")).toBeNull();
    expect(loadToken(s)).toBe(CLASSIC);
  });

  test("clear wipes both stores, not just the active one", () => {
    const s = stores();
    s.local.setItem("readmark-gh-token", FINE);
    s.session.setItem("readmark-gh-token", CLASSIC);
    clearToken(s);
    expect(loadToken(s)).toBeNull();
  });

  test("nothing stored reads as null", () => {
    expect(loadToken(stores())).toBeNull();
  });
});
