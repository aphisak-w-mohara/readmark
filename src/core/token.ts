/**
 * Storing a pasted GitHub token.
 *
 * The token is the fallback credential, used when there is no signed-in
 * session — the offline single-file build, or a self-hosted copy with no
 * OAuth callback. It lives in sessionStorage by default so it dies with the
 * tab; "remember" moves it to localStorage, which is a deliberate trade the
 * UI states out loud.
 *
 * Storage is injected, like prefs. Pure logic, faked stores in tests.
 */
import type { StorageLike } from "./prefs";

export interface TokenStore extends StorageLike {
  removeItem(key: string): void;
}

export interface TokenStores {
  session: TokenStore;
  local: TokenStore;
}

const KEY = "readmark-gh-token";

export type TokenKind = "fine-grained" | "classic" | "oauth";

export type TokenCheck = { ok: true; token: string; kind: TokenKind } | { ok: false; msg: string };

/**
 * Check a pasted string looks like a GitHub token before spending a request
 * on it — a mistyped paste should fail here, with a readable message, not as
 * a bewildering 401 three calls later.
 */
export function validateToken(raw: string): TokenCheck {
  const token = (raw || "").trim();
  if (!token) return { ok: false, msg: "Paste a GitHub token." };
  if (/\s/.test(token)) return { ok: false, msg: "That has spaces in it — paste the token only." };
  if (/^https?:\/\//i.test(token)) return { ok: false, msg: "That's a URL, not a token." };
  if (/^github_pat_[A-Za-z0-9_]{20,}$/.test(token))
    return { ok: true, token, kind: "fine-grained" };
  if (/^ghp_[A-Za-z0-9]{20,}$/.test(token)) return { ok: true, token, kind: "classic" };
  if (/^gho_[A-Za-z0-9]{20,}$/.test(token)) return { ok: true, token, kind: "oauth" };
  return {
    ok: false,
    msg: "That doesn't look like a GitHub token (expected github_pat_…, ghp_… or gho_…).",
  };
}

/** The stored token, session first — a tab-scoped one wins over a remembered one. */
export function loadToken(stores: TokenStores): string | null {
  return stores.session.getItem(KEY) ?? stores.local.getItem(KEY);
}

/** Whether the stored token was remembered across tabs. */
export function isRemembered(stores: TokenStores): boolean {
  return stores.local.getItem(KEY) !== null;
}

/** Store a token, in one place only. */
export function saveToken(stores: TokenStores, token: string, remember: boolean): void {
  clearToken(stores);
  (remember ? stores.local : stores.session).setItem(KEY, token);
}

/** Forget the token everywhere — both stores, whichever held it. */
export function clearToken(stores: TokenStores): void {
  stores.session.removeItem(KEY);
  stores.local.removeItem(KEY);
}
