/**
 * The one place that knows how a GitHub request is authenticated.
 *
 * Two methods, one interface: a signed-in session goes through the
 * same-origin proxy, which attaches an httpOnly cookie the page cannot read;
 * a pasted token goes straight to api.github.com with a Bearer header. Both
 * come back as the `FetchLike` that `core/pr.ts` already takes, so nothing
 * downstream branches on which is in use.
 */
import type { FetchLike, FetchResponse } from "../core/source";

export type Auth = { mode: "session" } | { mode: "token"; token: string };

/**
 * Whether signing in is offered at all. No GitHub App is registered yet, so
 * the OAuth callback would be dead; a pasted token is the way in until one
 * exists. The whole session path — proxy, cookies, refresh — stays in place
 * behind this, and flipping it back on is this one line.
 *
 * It lives here rather than in a view because every other site derives from
 * it: with sign-in off there is no probe, `store.auth` can never choose a
 * session, and no "Sign out" state is reachable.
 */
export const SIGN_IN_ENABLED = false;

export interface GhOptions {
  /** Injected for tests; defaults to the global fetch. */
  fetchFn?: typeof globalThis.fetch;
  /** Same-origin proxy root, for session requests. */
  base?: string;
}

const API = "https://api.github.com";
const COMMON: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

/**
 * Build the fetcher for a credential. Paths are API-relative
 * ("/repos/o/r/pulls/1"); the token, when there is one, only ever rides in a
 * header — never in the URL, where it would end up in logs and history.
 */
export function makeGhFetch(auth: Auth, opts: GhOptions = {}): FetchLike {
  const f = opts.fetchFn ?? globalThis.fetch;
  const base = opts.base ?? "/api/gh";
  return async (path: string, init?: { headers?: Record<string, string> }) => {
    const headers = { ...COMMON, ...(init?.headers ?? {}) };
    if (auth.mode === "token") {
      const res = await f(API + path, {
        headers: { ...headers, Authorization: `Bearer ${auth.token}` },
      });
      return res as unknown as FetchResponse;
    }
    const res = await f(base + path, { headers, credentials: "same-origin" });
    return res as unknown as FetchResponse;
  };
}

/**
 * Is the session backend reachable? A static build has no Functions behind
 * it, so there is nothing to sign in to and the UI should offer only a
 * token. A 401 still counts as present — the endpoint answered.
 */
export async function probeSession(
  opts: GhOptions = {},
): Promise<{ available: boolean; signedIn: boolean }> {
  const f = opts.fetchFn ?? globalThis.fetch;
  const base = opts.base ?? "/api/gh";
  try {
    const res = await f(base + "/user", {
      headers: COMMON,
      credentials: "same-origin",
    });
    if (res.status === 404 || res.status >= 500) return { available: false, signedIn: false };
    return { available: true, signedIn: res.ok };
  } catch {
    return { available: false, signedIn: false };
  }
}
