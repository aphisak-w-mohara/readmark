/**
 * The read-only GitHub proxy.
 *
 * Everything the signed-in app asks of GitHub comes through here, so the
 * access token can live in an httpOnly cookie the page cannot read. Only
 * GET, only the handful of endpoints reading a PR's Markdown needs, and the
 * token is never echoed back to the browser.
 */
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  clearCookie,
  isAllowed,
  readCookie,
  shouldRefresh,
  writeCookie,
} from "../_policy";
import { refresh, type Env } from "../_github";

interface Ctx {
  request: Request;
  env: Env;
  params: { path?: string | string[] };
}

const API = "https://api.github.com";

const json = (status: number, message: string, extra: HeadersInit = {}) =>
  new Response(JSON.stringify({ message }), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });

function callGitHub(path: string, token: string, accept: string): Promise<Response> {
  return fetch(API + path, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "User-Agent": "readmark",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

export const onRequestGet = async ({ request, env, params }: Ctx): Promise<Response> => {
  const url = new URL(request.url);
  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const path = "/" + segments.join("/") + url.search;

  if (!isAllowed(path)) return json(403, "That endpoint is not proxied.");

  const cookies = request.headers.get("Cookie");
  let token = readCookie(cookies, COOKIE_ACCESS);
  const refreshToken = readCookie(cookies, COOKIE_REFRESH);
  if (!token && !refreshToken) return json(401, "Not signed in.");

  const accept = request.headers.get("Accept") ?? "application/vnd.github+json";
  const setCookies: string[] = [];

  // No access token but a refresh token means the short-lived one aged out
  // between requests; renew before spending the round trip on a 401.
  if (!token && refreshToken) {
    try {
      const t = await refresh(env, refreshToken);
      token = t.accessToken;
      setCookies.push(writeCookie(COOKIE_ACCESS, t.accessToken, t.expiresIn - 60));
      if (t.refreshToken)
        setCookies.push(writeCookie(COOKIE_REFRESH, t.refreshToken, t.refreshExpiresIn));
    } catch {
      return json(401, "Session expired. Sign in again.", {
        "Set-Cookie": clearCookie(COOKIE_REFRESH),
      });
    }
  }

  let upstream = await callGitHub(path, token as string, accept);

  if (shouldRefresh(upstream.status, Boolean(refreshToken)) && setCookies.length === 0) {
    try {
      const t = await refresh(env, refreshToken as string);
      setCookies.push(writeCookie(COOKIE_ACCESS, t.accessToken, t.expiresIn - 60));
      if (t.refreshToken)
        setCookies.push(writeCookie(COOKIE_REFRESH, t.refreshToken, t.refreshExpiresIn));
      upstream = await callGitHub(path, t.accessToken, accept);
    } catch {
      /* fall through and let the original status stand */
    }
  }

  // Copy only what the app needs. Nothing from upstream sets cookies here,
  // and the Authorization header never travels back.
  const headers = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    "Cache-Control": "no-store",
  });
  for (const c of setCookies) headers.append("Set-Cookie", c);
  if (upstream.status === 401)
    for (const c of [clearCookie(COOKIE_ACCESS), clearCookie(COOKIE_REFRESH)])
      headers.append("Set-Cookie", c);

  return new Response(upstream.body, { status: upstream.status, headers });
};
