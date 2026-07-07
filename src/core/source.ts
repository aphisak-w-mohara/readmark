/**
 * Turning user input into Markdown text.
 *
 * `resolveGitHub` is pure URL logic — the leverage lives here and is fully
 * testable with strings. `fetchMarkdown` is the thin IO adapter over the seam
 * that actually varies: the network. `fetch` is injected so tests fake it.
 */

export type Resolved =
  | { kind: "raw"; url: string; name: string }
  | { kind: "api"; url: string; name: string }
  | { kind: "error"; msg: string };

export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchResponse>;

export interface Loaded {
  markdown: string;
  name: string;
}

export class SourceError extends Error {
  kind: "bad" | "net" | "http";
  constructor(kind: "bad" | "net" | "http", msg: string) {
    super(msg);
    this.kind = kind;
    this.name = "SourceError";
  }
}

/** Resolve any GitHub-ish input into a fetchable descriptor. */
export function resolveGitHub(input: string): Resolved {
  let u = (input || "").trim();
  if (!u) return { kind: "error", msg: "Enter a GitHub URL or owner/repo." };

  // already a raw URL
  if (/^(https?:\/\/)?raw\.githubusercontent\.com/i.test(u)) {
    return {
      kind: "raw",
      url: u.startsWith("http") ? u : "https://" + u,
      name: u.split("/").pop() || "document",
    };
  }
  // owner/repo shorthand
  if (/^[\w.-]+\/[\w.-]+$/.test(u)) u = "https://github.com/" + u;
  if (!/^https?:\/\//.test(u)) u = "https://" + u;

  // github.com/owner/repo/blob|raw/branch/path -> raw
  let m = u.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/i);
  if (m) {
    return {
      kind: "raw",
      url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`,
      name: m[4].split("/").pop() || "document",
    };
  }
  // repo root / tree -> README via API
  m = u.match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\/tree\/([^/]+).*|\/?$)/i);
  if (m) {
    return {
      kind: "api",
      url: `https://api.github.com/repos/${m[1]}/${m[2]}/readme${m[3] ? "?ref=" + m[3] : ""}`,
      name: m[2] + " · README",
    };
  }
  // any other markdown-ish URL
  if (/\.(md|markdown|txt|mdx)$/i.test(u))
    return { kind: "raw", url: u, name: u.split("/").pop() || "document" };
  return { kind: "raw", url: u, name: u.split("/").pop() || "document" };
}

/** Resolve + fetch. Throws a typed SourceError the UI can render. */
export async function fetchMarkdown(input: string, fetchFn: FetchLike): Promise<Loaded> {
  const r = resolveGitHub(input);
  if (r.kind === "error") throw new SourceError("bad", r.msg);

  const init = r.kind === "api" ? { headers: { Accept: "application/vnd.github.raw" } } : undefined;
  let res: FetchResponse;
  try {
    res = await fetchFn(r.url, init);
  } catch {
    throw new SourceError(
      "net",
      "Could not reach GitHub. Live fetching is blocked in the sandboxed preview — open the local build (network works there), or paste the Markdown instead.",
    );
  }
  if (!res.ok) {
    if (res.status === 404)
      throw new SourceError("http", "Not found (404). Check the path, or try another branch.");
    if (res.status === 403)
      throw new SourceError(
        "http",
        "GitHub rate-limited this request (403). Try again shortly, or paste the Markdown.",
      );
    throw new SourceError("http", "GitHub returned " + res.status + ".");
  }
  return { markdown: await res.text(), name: r.name };
}
