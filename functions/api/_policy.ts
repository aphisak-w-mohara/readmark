/**
 * What the proxy will and won't forward, and the cookie plumbing behind it.
 *
 * Kept separate from the handlers and free of any platform types, so the
 * rules that actually matter — which paths are reachable, when a token is
 * refreshed, how a cookie is written — are testable with `bun test`.
 */

/** The only GitHub endpoints reading a PR's Markdown needs. */
const ALLOWED: RegExp[] = [
  /^\/user$/,
  /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/,
  /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/files$/,
  /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/commits$/,
  /^\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/,
  /^\/repos\/[^/]+\/[^/]+\/compare\/[0-9a-zA-Z._-]+\.\.\.[0-9a-zA-Z._-]+$/,
  /^\/repos\/[^/]+\/[^/]+\/contents\/.+$/,
  /^\/repos\/[^/]+\/[^/]+\/git\/blobs\/[0-9a-f]{7,40}$/,
];

/**
 * Everything not on the list is refused. The query string is ignored for
 * matching, but traversal is not: a path segment of "." or ".." never
 * reaches GitHub. Checking segments rather than the raw string is what lets
 * `compare/a...b` through while `../` stays blocked.
 */
export function isAllowed(pathWithQuery: string): boolean {
  const path = pathWithQuery.split("?")[0];
  if (!path.startsWith("/") || path.includes("\\")) return false;
  if (path.split("/").some((seg) => seg === "." || seg === "..")) return false;
  if (/%2e|%2f|%5c/i.test(path)) return false; // no encoded traversal either
  return ALLOWED.some((re) => re.test(path));
}

export const COOKIE_ACCESS = "gh_at";
export const COOKIE_REFRESH = "gh_rt";
export const COOKIE_STATE = "gh_state";

/** Read one cookie out of a Cookie header. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Serialize a cookie. Always httpOnly and Secure: the page must not be able
 * to read the token, which is the entire reason the proxy exists.
 */
export function writeCookie(name: string, value: string, maxAge: number): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ];
  return parts.join("; ");
}

/** A cookie that deletes the one already there. */
export function clearCookie(name: string): string {
  return writeCookie(name, "", 0);
}

/** Whether a response means "try refreshing the access token and go again". */
export function shouldRefresh(status: number, hasRefreshToken: boolean): boolean {
  return hasRefreshToken && (status === 401 || status === 403);
}

const RETURN_BASE = "https://readmark.invalid";

/**
 * Only same-origin, absolute-path returns — this value lands in a Location
 * header after sign-in, which is the classic open-redirect phishing spot.
 *
 * A prefix check is not enough. Browsers fold "\\" into "/" and strip tabs
 * and newlines inside URLs, so "/\\evil.example" and "/<tab>/evil.example"
 * are protocol-relative in practice; the URL parser is the only thing that
 * agrees with what a browser will actually do. The parse can also yield a
 * same-origin result whose path still begins "//" (from "/..//evil"), which
 * would be protocol-relative all over again — so the output is checked too.
 */
export function safeReturnPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/";
  let path: string;
  try {
    const url = new URL(raw, RETURN_BASE);
    if (url.origin !== RETURN_BASE) return "/";
    path = url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}
