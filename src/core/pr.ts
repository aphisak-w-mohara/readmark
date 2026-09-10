/**
 * Pull requests: resolving a URL, listing the Markdown files it touches, and
 * fetching both sides of one file.
 *
 * `resolvePR` is pure URL logic. Everything else takes an injected fetch —
 * the same seam `fetchMarkdown` uses — so the network is faked in tests and
 * so the caller decides whether requests go through the session proxy or
 * straight to api.github.com with a token.
 */
import { SourceError, type FetchLike } from "./source";

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

export interface PrInfo extends PrRef {
  title: string;
  baseSha: string;
  headSha: string;
  url: string;
}

export interface PrFile {
  /** Path in the head commit. */
  filename: string;
  /** Path in the base commit — differs only for renames. */
  previousFilename: string;
  status: "added" | "removed" | "modified" | "renamed" | "changed" | "copied" | "unchanged";
  additions: number;
  deletions: number;
}

export interface PrFiles {
  markdown: PrFile[];
  /** How many changed files were not Markdown; GitHub already diffs those well. */
  otherCount: number;
}

export interface PrSides {
  before: string;
  after: string;
}

export interface PrCommit {
  sha: string;
  /** First parent — the commit this one was applied on top of. */
  parent: string;
  /** Subject line only; commit bodies belong on GitHub. */
  subject: string;
  author: string;
  date: string;
}

/**
 * Which commits to diff. `null` means the pull request as a whole; a range
 * is inclusive of both ends and is resolved to "the parent of the first"
 * against "the last", which is what makes it read as those commits' work.
 */
export interface CommitRange {
  fromSha: string;
  toSha: string;
}

const MARKDOWN = /\.(md|markdown|mdx)$/i;

/** Largest blob worth fetching; past this the reader is not the right tool. */
export const MAX_BLOB_BYTES = 1_000_000;

/** Recognise a GitHub pull request URL. Returns null for anything else. */
export function resolvePR(input: string): PrRef | null {
  const u = (input || "").trim();
  if (!u) return null;
  const m = u.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/[\w/.-]*)?\/?(?:[?#].*)?$/i,
  );
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

async function getJson<T>(fetchFn: FetchLike, path: string): Promise<T> {
  let res;
  try {
    res = await fetchFn(path);
  } catch {
    throw new SourceError("net", "Could not reach GitHub. Check your connection and try again.");
  }
  if (!res.ok) throw httpError(res.status);
  return JSON.parse(await res.text()) as T;
}

/** Turn a GitHub status code into something a reader can act on. */
export function httpError(status: number): SourceError {
  if (status === 401)
    return new SourceError(
      "http",
      "GitHub rejected the credentials. Sign in again, or re-enter your token.",
    );
  if (status === 403)
    return new SourceError(
      "http",
      "GitHub rate-limited or refused this request (403). Try again shortly.",
    );
  if (status === 404)
    return new SourceError(
      "http",
      "Not found (404). Private repositories look like this when your credentials don't cover them — check the PR exists and that your access includes this repository.",
    );
  return new SourceError("http", "GitHub returned " + status + ".");
}

interface RawPr {
  title: string;
  html_url: string;
  base: { sha: string };
  head: { sha: string };
}

/** Fetch a PR's metadata: title and the two commits to diff between. */
export async function fetchPr(ref: PrRef, fetchFn: FetchLike): Promise<PrInfo> {
  const raw = await getJson<RawPr>(fetchFn, `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`);
  return {
    ...ref,
    title: raw.title,
    baseSha: raw.base.sha,
    headSha: raw.head.sha,
    url: raw.html_url,
  };
}

interface RawFile {
  filename: string;
  previous_filename?: string;
  status: PrFile["status"];
  additions: number;
  deletions: number;
}

/**
 * List the PR's Markdown files, following pagination. GitHub caps a PR's
 * file list at 3000; past that it is not a document review any more.
 */
function partition(files: RawFile[]): PrFiles {
  const markdown: PrFile[] = [];
  let otherCount = 0;
  for (const f of files) {
    if (!MARKDOWN.test(f.filename)) {
      otherCount++;
      continue;
    }
    markdown.push({
      filename: f.filename,
      previousFilename: f.previous_filename ?? f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
    });
  }
  return { markdown, otherCount };
}

export async function listMarkdownFiles(ref: PrRef, fetchFn: FetchLike): Promise<PrFiles> {
  const all: RawFile[] = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await getJson<RawFile[]>(
      fetchFn,
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=100&page=${page}`,
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return partition(all);
}

interface RawCommit {
  sha: string;
  parents: { sha: string }[];
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string } | null;
}

/**
 * The PR's commits, oldest first. GitHub caps this endpoint at 250; past
 * that a range picker is not the right tool anyway.
 */
export async function listCommits(ref: PrRef, fetchFn: FetchLike): Promise<PrCommit[]> {
  const out: PrCommit[] = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await getJson<RawCommit[]>(
      fetchFn,
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/commits?per_page=100&page=${page}`,
    );
    for (const c of batch)
      out.push({
        sha: c.sha,
        parent: c.parents[0]?.sha ?? "",
        subject: (c.commit.message || "").split("\n")[0],
        author: c.author?.login ?? c.commit.author?.name ?? "unknown",
        date: c.commit.author?.date ?? "",
      });
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * Resolve a range to the two commits to diff between. Without a range that
 * is the pull request's own base and head.
 */
export function resolveRange(
  pr: PrInfo,
  commits: PrCommit[],
  range: CommitRange | null,
): { base: string; head: string } {
  if (!range) return { base: pr.baseSha, head: pr.headSha };
  const from = commits.find((c) => c.sha === range.fromSha);
  const to = commits.find((c) => c.sha === range.toSha);
  if (!from || !to) return { base: pr.baseSha, head: pr.headSha };
  // The parent of the first commit is where its work starts.
  return { base: from.parent || pr.baseSha, head: to.sha };
}

interface RawCompare {
  files?: RawFile[];
}

/** The Markdown files changed between two commits. */
export async function listMarkdownFilesBetween(
  ref: PrRef,
  base: string,
  head: string,
  fetchFn: FetchLike,
): Promise<PrFiles> {
  const cmp = await getJson<RawCompare>(
    fetchFn,
    `/repos/${ref.owner}/${ref.repo}/compare/${base}...${head}`,
  );
  return partition(cmp.files ?? []);
}

interface RawReview {
  user: { login: string } | null;
  state: string;
  commit_id: string | null;
  submitted_at: string | null;
}

/** The signed-in user's login, for "since my last review". */
export async function currentLogin(fetchFn: FetchLike): Promise<string | null> {
  try {
    const me = await getJson<{ login?: string }>(fetchFn, "/user");
    return me.login ?? null;
  } catch {
    return null;
  }
}

/**
 * The commit this user last reviewed at, or null if they never have.
 * Pending reviews carry no commit and are ignored.
 */
export async function lastReviewedCommit(
  ref: PrRef,
  login: string,
  fetchFn: FetchLike,
): Promise<string | null> {
  let latest: string | null = null;
  for (let page = 1; page <= 3; page++) {
    const batch = await getJson<RawReview[]>(
      fetchFn,
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews?per_page=100&page=${page}`,
    );
    for (const r of batch)
      if (r.user?.login === login && r.state !== "PENDING" && r.commit_id) latest = r.commit_id;
    if (batch.length < 100) break;
  }
  return latest;
}

interface RawContent {
  content?: string;
  encoding?: string;
  size?: number;
}

function decodeBase64(s: string): string {
  const bytes = Uint8Array.from(atob(s.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** One side of one file, or "" when the file does not exist on that side. */
async function fetchSide(
  ref: PrRef,
  path: string,
  sha: string,
  fetchFn: FetchLike,
): Promise<string> {
  let res;
  try {
    res = await fetchFn(
      `/repos/${ref.owner}/${ref.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`,
    );
  } catch {
    throw new SourceError("net", "Could not reach GitHub. Check your connection and try again.");
  }
  if (res.status === 404) return ""; // added on one side, or deleted on the other
  if (!res.ok) throw httpError(res.status);
  const raw = JSON.parse(await res.text()) as RawContent;
  if (raw.size !== undefined && raw.size > MAX_BLOB_BYTES)
    throw new SourceError("http", "That file is too large to diff here (over 1 MB).");
  if (!raw.content) return "";
  return raw.encoding === "base64" ? decodeBase64(raw.content) : raw.content;
}

/** Fetch both versions of one changed file. */
export async function fetchSides(pr: PrInfo, file: PrFile, fetchFn: FetchLike): Promise<PrSides> {
  const [before, after] = await Promise.all([
    file.status === "added"
      ? Promise.resolve("")
      : fetchSide(pr, file.previousFilename, pr.baseSha, fetchFn),
    file.status === "removed"
      ? Promise.resolve("")
      : fetchSide(pr, file.filename, pr.headSha, fetchFn),
  ]);
  return { before, after };
}
