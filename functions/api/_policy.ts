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
  /^\/repos\/[^/]+\/[^/]+\/contents\/.+$/,
  /^\/repos\/[^/]+\/[^/]+\/git\/blobs\/[0-9a-f]{7,40}$/,
];

/**
 * Everything not on the list is refused. The query string is ignored for
 * matching but path traversal is not: `..` never reaches GitHub.
 */
export function isAllowed(pathWithQuery: string): boolean {
  const path = pathWithQuery.split("?")[0];
  if (!path.startsWith("/") || path.includes("..") || path.includes("\\")) return false;
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

/** Only same-origin, absolute-path returns — never an attacker's URL. */
export function safeReturnPath(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
