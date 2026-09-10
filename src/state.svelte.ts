/**
 * Reactive application state (Svelte 5 runes).
 *
 * This is the thin glue tier: it owns reactive state and delegates all real
 * work to the pure core (prefs validation/persistence, markdown rendering,
 * highlighting, diffing). The core never imports Svelte.
 */
import DOMPurify from "dompurify";
import { loadPrefs, savePrefs, type Prefs, type StorageLike } from "./core/prefs";
import { toHtml, type Rendered } from "./core/markdown";
import { toDiffHtml, type DiffDoc } from "./core/diff";
import { highlight } from "./core/highlight";
import { SourceError, type FetchLike } from "./core/source";
import {
  currentLogin,
  fetchPr,
  fetchSides,
  lastReviewedCommit,
  listCommits,
  listMarkdownFiles,
  listMarkdownFilesBetween,
  resolvePR,
  resolveRange,
  type CommitRange,
  type PrCommit,
  type PrFile,
  type PrFiles,
  type PrInfo,
} from "./core/pr";
import { clearToken, loadToken, saveToken, type TokenStore, type TokenStores } from "./core/token";
import { makeGhFetch, probeSession, type Auth } from "./lib/gh";

const memory: StorageLike = (() => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
})();

const memoryToken = (): TokenStore => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

const storage: StorageLike = typeof localStorage !== "undefined" ? localStorage : memory;
const tokenStores: TokenStores = {
  session: typeof sessionStorage !== "undefined" ? sessionStorage : memoryToken(),
  local: typeof localStorage !== "undefined" ? localStorage : memoryToken(),
};

/** Sanitize once, in one place: the parser deliberately passes raw HTML through. */
const clean = (html: string) => DOMPurify.sanitize(html, { ADD_ATTR: ["target", "loading"] });

export type Layout = "unified" | "split";
export type Scope = "all" | "changed";

class ReadmarkStore {
  prefs = $state<Prefs>(loadPrefs(storage));
  doc = $state<Rendered>({ html: "", headings: [], title: "Readmark" });
  outlineOpen = $state(true);
  zen = $state(false);

  // PR review
  mode = $state<"doc" | "diff">("doc");
  pr = $state<PrInfo | null>(null);
  files = $state<PrFiles | null>(null);
  activeFile = $state<PrFile | null>(null);
  diff = $state<DiffDoc | null>(null);
  commits = $state<PrCommit[]>([]);
  /** null = the pull request as a whole. */
  range = $state<CommitRange | null>(null);
  /** The commit this user last reviewed at, if they have. */
  lastReviewSha = $state<string | null>(null);
  layout = $state<Layout>("unified");
  scope = $state<Scope>("all");
  busy = $state(false);

  // credentials
  session = $state<{ available: boolean; signedIn: boolean }>({
    available: false,
    signedIn: false,
  });
  token = $state<string | null>(loadToken(tokenStores));

  constructor() {
    this.outlineOpen = this.prefs.outline;
  }

  /** Which credential a GitHub request should use; a live session wins. */
  get auth(): Auth | null {
    if (this.session.signedIn) return { mode: "session" };
    if (this.token) return { mode: "token", token: this.token };
    return null;
  }

  /** Ask the origin whether there is a backend to sign in to at all. */
  async checkSession() {
    this.session = await probeSession();
  }

  setToken(token: string, remember: boolean) {
    saveToken(tokenStores, token, remember);
    this.token = token;
  }

  forgetToken() {
    clearToken(tokenStores);
    this.token = null;
  }

  /** Render Markdown, then sanitize the HTML. */
  load(markdown: string) {
    const rendered = toHtml(markdown, { highlight });
    this.doc = { ...rendered, html: clean(rendered.html) };
    this.mode = "doc";
    this.pr = null;
    this.files = null;
    this.activeFile = null;
    this.diff = null;
    this.commits = [];
    this.range = null;
    this.lastReviewSha = null;
  }

  /**
   * Load a pull request: metadata, its Markdown files, then the first one.
   * Throws a typed SourceError the modal renders.
   */
  async openPr(url: string) {
    const ref = resolvePR(url);
    if (!ref) throw new SourceError("bad", "That is not a GitHub pull request URL.");
    const auth = this.auth;
    if (!auth) throw new SourceError("bad", "Sign in with GitHub, or add a token, to read a PR.");

    const gh = makeGhFetch(auth);
    this.busy = true;
    try {
      const [pr, files, commits] = await Promise.all([
        fetchPr(ref, gh),
        listMarkdownFiles(ref, gh),
        listCommits(ref, gh),
      ]);
      if (!files.markdown.length)
        throw new SourceError(
          "http",
          `This PR changes no Markdown files${files.otherCount ? ` (${files.otherCount} other files changed)` : ""}.`,
        );
      this.pr = pr;
      this.files = files;
      this.commits = commits;
      this.range = null;
      this.mode = "diff";
      await this.openFile(files.markdown[0]);
      // Best-effort: the range picker offers "since my last review" only
      // when there is one, and never blocks the diff on finding out.
      void this.findLastReview(ref, gh);
    } finally {
      this.busy = false;
    }
  }

  private async findLastReview(
    ref: { owner: string; repo: string; number: number },
    gh: FetchLike,
  ) {
    this.lastReviewSha = null;
    const login = await currentLogin(gh);
    if (!login) return;
    try {
      this.lastReviewSha = await lastReviewedCommit(ref, login, gh);
    } catch {
      this.lastReviewSha = null;
    }
  }

  /** The two commits currently being diffed between. */
  get shas(): { base: string; head: string } | null {
    return this.pr ? resolveRange(this.pr, this.commits, this.range) : null;
  }

  /**
   * Narrow the diff to a range of commits, or the whole PR when null. The
   * file list is recomputed: a file touched outside the range is not part
   * of this view, so the selection resets to the first that is.
   */
  async setRange(range: CommitRange | null) {
    const pr = this.pr;
    const auth = this.auth;
    if (!pr || !auth) return;
    const gh = makeGhFetch(auth);
    this.busy = true;
    try {
      this.range = range;
      const { base, head } = resolveRange(pr, this.commits, range);
      const files = range
        ? await listMarkdownFilesBetween(pr, base, head, gh)
        : await listMarkdownFiles(pr, gh);
      this.files = files;
      if (!files.markdown.length) {
        this.diff = null;
        this.activeFile = null;
        this.doc = { html: "", headings: [], title: "No Markdown in range" };
        return;
      }
      const keep = files.markdown.find((f) => f.filename === this.activeFile?.filename);
      await this.openFile(keep ?? files.markdown[0]);
    } finally {
      this.busy = false;
    }
  }

  /** Switch to another changed file within the open PR. */
  async openFile(file: PrFile) {
    const pr = this.pr;
    const auth = this.auth;
    if (!pr || !auth) return;
    this.busy = true;
    try {
      const { base, head } = resolveRange(pr, this.commits, this.range);
      const { before, after } = await fetchSides(
        { ...pr, baseSha: base, headSha: head },
        file,
        makeGhFetch(auth),
      );
      const diff = toDiffHtml(before, after, { highlight });
      this.diff = {
        ...diff,
        rows: diff.rows.map((r) => ({
          ...r,
          unified: clean(r.unified),
          before: clean(r.before),
          after: clean(r.after),
        })),
      };
      this.activeFile = file;
      // The outline and the tab title come from the document being reviewed.
      this.doc = {
        html: "",
        headings: diff.headings,
        title: file.filename.split("/").pop() ?? file.filename,
      };
    } finally {
      this.busy = false;
    }
  }

  /** Update reading preferences and persist. */
  patchPrefs(patch: Partial<Prefs>) {
    this.prefs = { ...this.prefs, ...patch };
    savePrefs(storage, this.prefs);
  }

  toggleOutline() {
    this.outlineOpen = !this.outlineOpen;
    this.patchPrefs({ outline: this.outlineOpen });
  }

  toggleZen() {
    this.zen = !this.zen;
  }
}

export const store = new ReadmarkStore();
