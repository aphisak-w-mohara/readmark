# PR markdown diff review — design

**Date:** 2026-09-10
**Status:** approved, ready to plan
**Scope:** Phase 1 only — reading a PR's markdown diff. Phase 2 (review comments, approve / request changes) gets its own spec.

## Problem

Reviewing a markdown file in a GitHub PR is noisy out of proportion to the change. GitHub diffs the raw source line by line, so a paragraph that was rewrapped shows as every line removed and every line added, even when three words actually changed. The reviewer's job — judge the prose — is buried under a patch.

Readmark already renders markdown beautifully from a GitHub URL. It should be able to render the _change_ just as well.

## Goal

Paste a PR URL into Readmark's existing Open modal and read the change as prose: the document rendered normally, with only the words that actually changed marked. Rewrapping is invisible. Jumping between real changes is one keystroke.

## Non-goals (Phase 1)

- Posting comments, approving, or requesting changes. Phase 2.
- Diffing non-markdown files. GitHub's code diff is fine; those files are counted, not rendered.
- Move detection across a document (see Known ceilings).
- Providers other than GitHub.

## Decisions

| Decision       | Choice                                                        | Why                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry point    | Paste a PR URL into the existing Open modal                   | No new entry UI; `resolveGitHub` already owns URL interpretation                                                                                                                                                 |
| Diff display   | Layout (unified \| split) × scope (whole doc \| changes only) | Two orthogonal toggles cover the three views asked for, in less code than three view components                                                                                                                  |
| Multi-file PRs | File picker, one document at a time                           | The whole reader is built around one document in one column                                                                                                                                                      |
| Repo access    | GitHub App, user-access token                                 | Fine-grained `Contents: read` + `Pull requests: read`; Phase 2 becomes a permission bump, not an escalation to blanket `repo`                                                                                    |
| Token storage  | httpOnly cookie, proxied API                                  | The app renders untrusted markdown; a JS-readable token is one sanitizer bypass from exfiltration                                                                                                                |
| Fallback auth  | Pasted token, `sessionStorage` by default                     | The App needs the deployed origin; a token is the only way PR mode works in the offline single-file build or a self-hosted copy. Note it does **not** bypass org approval for org-owned private repos — see Auth |
| Diff engine    | Source block-align → word-diff → sentinel re-render           | Reuses the existing parser; stays pure, so it tests with `bun test` like the rest of `core/`                                                                                                                     |
| Write-back     | None in Phase 1                                               | Read-only scope, no confirm-before-post UX, nothing a bug can break                                                                                                                                              |

### Rejected alternatives

- **Browser extension on GitHub.** Best placement in the review flow, but a second deliverable: manifest, build target, store distribution, permissions.
- **Rendered-DOM diff.** No sentinel handling needed, but requires a DOM, so it cannot live in `core/`, cannot be tested with `bun test`, and breaks the pure-core / thin-view split.
- **Rendering GitHub's unified patch.** Trivial to build, but line-based and reflow-blind — it _is_ the noise problem.
- **OAuth App instead of GitHub App.** No per-repo install step, but no read-only private scope exists: reading a private repo needs blanket `repo`, granting full write across every repo the user can touch.
- **PAT as the only auth method.** Simpler — no Pages Function, no OAuth registration. Rejected as the _primary_ path because a JS-readable token is exfiltratable through any sanitizer bypass, and this app renders markdown written by other people. Kept as an explicit fallback (see Auth), because the App cannot cover the offline build or a self-hosted origin.
- **PAT held in a Web Worker.** Would stop an XSS from stealing the token itself (it could still ask the worker to make requests). Real improvement, but a worker plus a message protocol for a fallback path — see Known ceilings.

## Architecture

Pure core, thin view, matching the existing structure.

```
src/core/
├─ blocks.ts   splitBlocks(src) -> Block[]
├─ align.ts    align(before: Block[], after: Block[]) -> Change[]
├─ diff.ts     wordDiff(a, b) -> merged source with sentinels
│              toDiffHtml(before, after, {highlight}) -> DiffDoc
├─ pr.ts       resolvePR(url), listMarkdownFiles(pr, fetch), fetchSides(file, fetch)
└─ token.ts    validateToken(s), load/save/clear against an injected StorageLike

src/lib/
└─ gh.ts       makeGhFetch(auth) -> FetchLike   picks proxy vs direct api.github.com

functions/api/
├─ auth/login.ts      302 to GitHub authorize; random state in an httpOnly cookie
├─ auth/callback.ts   verify state, exchange code + secret, set token cookies
├─ auth/logout.ts     clear cookies
└─ gh/[[path]].ts     GET-only allowlisted proxy to api.github.com

src/components/
├─ PrBar.svelte     PR title, file picker, layout/scope toggles, change nav
└─ DiffView.svelte  renders a DiffDoc under the current layout + scope
```

The only change to existing core is extracting `blocks.ts` out of `markdown.ts`. The parser already walks blocks internally; the split gives the renderer and the differ one shared definition of "a block" instead of two that can drift.

### Types

```ts
type BlockKind = "heading" | "para" | "list" | "code" | "quote" | "table" | "html" | "hr";

interface Block {
  kind: BlockKind;
  src: string; // verbatim markdown source of the block
  text: string; // inline markup stripped, whitespace collapsed — the align key
  line: number; // 1-based source line where the block starts
}

type Change =
  | { op: "same"; before: Block; after: Block }
  | { op: "changed"; before: Block; after: Block }
  | { op: "added"; after: Block }
  | { op: "removed"; before: Block };

interface DiffDoc {
  changes: Change[];
  html: { unified: string; before: string; after: string }[]; // parallel to changes
  headings: (Heading & { changed: boolean })[]; // after side; changed = section touched
  counts: { added: number; removed: number; changed: number };
}
```

`Block.line` is unused in Phase 1. It is included because Phase 2's comment anchoring needs a source line per block, and retrofitting it means re-plumbing the parser.

### Data flow

```
PR url
  → resolvePR                     pure URL parsing
  → GET /api/gh/repos/:o/:r/pulls/:n         PR metadata
  → GET /api/gh/repos/:o/:r/pulls/:n/files   changed files (paginated)
  → filter to .md/.markdown/.mdx             non-markdown counted, not fetched
  → pick a file
  → GET both blobs (base sha, head sha)
  → splitBlocks ×2 → align → wordDiff on `changed` pairs → toHtml
  → DiffDoc
  → DiffView
```

The `/api/gh/*` paths above are Method A. Under Method B the same requests go straight to `api.github.com` with a Bearer header — same call sites, different `FetchLike` (see Auth).

Layout and scope are view-only filters over one `DiffDoc`. Flipping a toggle never re-diffs.

## Diff engine

1. **Split.** `splitBlocks` walks the source once and emits blocks. Fenced code is one block including its blank lines. A list is one block, not one block per item — item-level changes fall out of the word diff.

2. **Align.** LCS over `Block.text`, the whitespace-collapsed, inline-markup-stripped key. This is where reflow immunity comes from: a rewrapped paragraph has an identical key, so it aligns as `same` and never reaches the word differ. Unmatched pairs that are adjacent and similar above a threshold become `changed`; the rest are `added` / `removed`.

3. **Word diff.** For a `changed` pair, tokenize both sources markdown-aware — a token is a word, a run of punctuation, or a whole inline construct (`[text](url)`, `` `code` ``, `![img](src)`, an html tag). Never split inside a construct; a diff boundary inside a link produces broken markdown. Then LCS the token lists.

4. **Sentinel re-render.** Emit one merged source where removed runs are wrapped in `\x04…\x05` and inserted runs in `\x06…\x07`, render it through the existing `toHtml`, then replace the sentinels with `<ins>` / `<del>`. The parser already uses `\x01`–`\x03` for the same purpose (`src/core/markdown.ts:26-28`), so this is the established idiom here. Strip `\x04`–`\x07` from both inputs first, so a hostile document cannot forge markers.

5. **Special cases.**
   - Fenced code blocks diff by line, not by word.
   - A changed Mermaid block renders the after diagram with a "changed" badge; split view shows both diagrams.
   - `added` / `removed` whole blocks get a gutter bar, no word marks.
   - A heading whose level changed but whose text matches is a `changed` pair with a kind badge.

Everything in steps 1–4 is string in, string out. No DOM, no Svelte, no IO.

## Auth

Two methods. The GitHub App is the default and the safer one; a pasted personal access token is the fallback for the cases the App cannot reach.

### Method A — GitHub App (default)

GitHub App with `Contents: read` and `Pull requests: read`. User-access token via the web flow.

`functions/` deploys with the existing Cloudflare Pages project — same repo, same CI, no new infrastructure. `GH_CLIENT_ID` and `GH_CLIENT_SECRET` are encrypted Pages environment variables.

The token exchange must be server-side: GitHub's token endpoint sends no CORS headers, so a browser cannot call it, and the client secret cannot ship to the browser regardless.

**Cookies.** Access token and refresh token both httpOnly, Secure, SameSite=Lax. Nothing readable by page script. User-access tokens expire after 8 hours with a rotating refresh token; the proxy refreshes transparently on a 401 and retries the request once. A failed refresh clears both cookies and surfaces the signed-out state.

**Proxy allowlist**, GET only:

```
/repos/:owner/:repo/pulls/:number
/repos/:owner/:repo/pulls/:number/files
/repos/:owner/:repo/contents/*
/repos/:owner/:repo/git/blobs/*
/user
```

Everything else returns 403. GET-only plus SameSite=Lax means no CSRF token is needed in Phase 1; Phase 2's writes will need one.

**Local development.** `wrangler pages dev --proxy 5173 -- bun run dev`, with a second callback URL registered on the GitHub App for localhost.

### Method B — personal access token (fallback)

Method A cannot cover two situations: the offline single-file build has no Pages Function to proxy through, and a self-hosted copy of `dist/index.html` on some other origin has no OAuth callback registered. A pasted token covers both.

**It does not bypass org approval.** A fine-grained PAT against an organization-owned private repo requires that org to have enabled fine-grained tokens, and where the org requires approval, an owner approves each token request — the same wall as installing the App, in a different queue. The matrix:

| Token                 | Org-owned private repo                                                                 | Approved by |
| --------------------- | -------------------------------------------------------------------------------------- | ----------- |
| Fine-grained PAT      | Only if the org enables fine-grained tokens; usually per-token approval                | Org owner   |
| Classic PAT           | Works unless the org restricts classic tokens; under SAML SSO the user self-authorizes | The user    |
| GitHub App (Method A) | Requires installation on the org                                                       | Org owner   |

So the only admin-free route to an org's private repos is a classic PAT carrying blanket `repo` — write access across everything the user can touch. That is the least safe of the three and the one needing nobody's permission. The UI must not quietly steer people there.

**What to paste.** Preferred: a fine-grained PAT scoped to the repositories you review, `Contents: read-only` and `Pull requests: read-only`, short expiry. Accepted with a warning at the point of entry: a classic PAT, which has no read-only private scope and therefore carries blanket `repo` write. Also accepted: a `gho_` OAuth token such as the one `gh auth token` prints — same header, same broad scope, already SSO-authorized, useful for getting going before an owner approves anything.

**Recorded unknown.** Whether HelloMOHARA and MO-BKK permit fine-grained PATs, and whether they require per-token approval, is not readable from a member account. Confirm before planning assumes any particular path works; the token entry UI must degrade honestly when the answer turns out to be no.

**Where it goes.** `sessionStorage` by default — gone when the tab closes. An explicit _remember on this device_ checkbox moves it to `localStorage`, with the trade-off stated in the UI next to the checkbox, not buried in docs. Stored under its own key, never inside the prefs blob: prefs are rewritten on every preference change and are the kind of thing that ends up in an export or a log.

**Where it travels.** Only as an `Authorization: Bearer` header to `https://api.github.com`. Never in a URL or query string, never to the Pages Function, never anywhere else. When a PAT is in use the app talks to GitHub directly and the proxy is bypassed entirely, so the Cloudflare side never sees the token.

**Lifecycle.** Cleared on any 401, on _forget token_, and on sign-in via Method A. `validateToken` checks the shape (`ghp_` / `github_pat_` / `gho_` prefix, length) before the first request, so a mistyped paste fails immediately with a clear message instead of a confusing 401.

**Precedence.** A live Method A session always wins. The PAT is consulted only when there is no session cookie. The app probes `GET /api/gh/user` once on load: a response means the Functions exist and Method A is offered; a network or 404 failure means this is a static build, and the UI offers only Method B.

**The risk, stated plainly.** A token in `sessionStorage` or `localStorage` is readable by any script running on the origin. This app renders markdown authored by other people, and DOMPurify is the only thing standing between a hostile document and script execution. If that sanitization is ever bypassed, a Method A session cookie cannot be read by the attacker's script but a Method B token can be — and a stolen token keeps working from the attacker's machine until it is revoked or expires. That is the reason Method A is the default and Method B says so at the point of entry. Fine-grained scope and a short expiry bound the damage; they do not remove it.

### One seam, two methods

`core/pr.ts` already takes an injected `FetchLike`, so it does not know or care which method is in use. `lib/gh.ts` builds the right one:

```ts
type Auth = { mode: "session" } | { mode: "token"; token: string };

// session → same-origin /api/gh/*, cookie sent automatically
// token   → https://api.github.com/*, Authorization: Bearer
function makeGhFetch(auth: Auth): FetchLike;
```

That is the whole integration. No branching inside the PR logic, and tests fake one function.

### With neither method

No session and no token means no PR mode: pasting a PR URL shows the sign-in / paste-token choice instead of an error. Public repos are _not_ read unauthenticated — 60 requests an hour cannot survive a PR with a few files, and a half-working anonymous path is worse than a clear prompt.

Pasted markdown and raw-URL reading are untouched either way. The self-contained `dist/index.html` still works from a double-click for everything, and with a PAT it now covers PR mode too.

## UI

**Entry.** `resolveGitHub` gains a `"pr"` kind. Pasting `https://github.com/owner/repo/pull/123` into the existing Open modal works; today it falls through to a raw-branch fetch and 404s. Also accept `/pull/123/files` and `/pull/123/commits/:sha`.

**Auth panel.** Shown inside the Open modal when a PR URL is pasted with no credentials. On a deployed origin: a _Sign in with GitHub_ button first, and below it a collapsed _use a token instead_ disclosure. On a static build, where the probe found no Functions, only the token path is shown, with one line saying why. The token field is `type="password"`, `autocomplete="off"`, paired with the _remember on this device_ checkbox and a one-line statement of what that means. A link to GitHub's fine-grained-token page pre-fills nothing — it just gets you there. Once a token is stored, the panel collapses to its last 4 characters plus a _forget token_ button.

**PrBar** replaces TopBar's document title in diff mode:

- PR number, title, link out to GitHub
- file picker: changed markdown files with per-file `+n −m`; a note counting the non-markdown files
- layout toggle: Unified | Split
- scope toggle: Whole doc | Changes only
- change navigation `‹ n/m ›`, bound to `j` / `k`

The change navigation is the core ergonomic win: on a long README with three changed words, `j` puts you on them.

**Rendering.**

- _Unified_ — one reading column. Deletions struck through on a muted red wash, insertions on a green wash.
- _Split_ — CSS grid, before | after, matched blocks on the same row. One scroller over aligned rows, so scroll sync needs no JS. Cost: a long block on one side pads the other.
- _Changes only_ — `same` blocks collapse to a `⋯ n unchanged paragraphs` spacer that expands on click. The heading above each change stays visible, so no change is read without its section.

**Theming.** Insert and delete colours are two custom properties per theme in `app.css`, defined for all five papers. The washes tuned for `original` do not work on `sepia` or `black`.

**Outline and status.** Outline is built from the after side, with a marker on headings whose section changed. StatusBar reuses the existing reading math over the after side.

Body stays serif, chrome stays sans — the split the reader already uses.

## Errors

Typed like the existing `SourceError`, rendered in the Open modal.

| Case                                 | Behaviour                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not signed in / refresh failed       | Sign in with GitHub, or paste a token                                                                                                                             |
| Token fails shape check              | Reject before any request: "That doesn't look like a GitHub token"                                                                                                |
| Token rejected (401)                 | Clear it, say it was rejected or has expired, offer re-entry                                                                                                      |
| Token lacks access to the repo (404) | GitHub returns 404 rather than 403 for private repos a token cannot see — say the token may not cover this repository, rather than claiming the PR does not exist |
| App not installed on the repo        | Message naming the repo, plus an install link                                                                                                                     |
| PR has no markdown changes           | Say so, link to the PR on GitHub                                                                                                                                  |
| Blob over 1 MB                       | Skip that file with a note in the picker                                                                                                                          |
| Deleted file                         | Render before-only, whole document marked removed                                                                                                                 |
| Renamed file                         | Align across the rename using `previous_filename`                                                                                                                 |
| Over 100 changed files               | Paginate the files endpoint                                                                                                                                       |
| Rate limited                         | Show the reset time                                                                                                                                               |
| Network failure                      | Existing `SourceError("net")` path                                                                                                                                |

## Testing

Pure `bun test`, in the style of the existing 41 tests.

- **blocks.ts** — fenced code containing blank lines; nested lists; tables; setext headings; raw HTML blocks; `line` is correct after each of these.
- **align.ts** — a pure rewrap yields all `same`; a three-word edit inside a rewrapped paragraph yields exactly one `changed`; inserting a block at the top does not cascade every later block into `changed`.
- **diff.ts** — tokenizing never splits inside `[text](url)` or inline code; sentinel characters present in the input are stripped, so a document cannot forge `<ins>`; code blocks diff by line; and the property that catches most engine bugs: **`toDiffHtml(x, x)` renders byte-identical to `toHtml(x)`**.
- **token.ts** — shape validation accepts `ghp_`, `github_pat_` and `gho_`, rejects whitespace, truncation and a pasted URL; save honours the remember flag by writing to the right injected store; clear wipes both stores, not just the active one.
- **lib/gh.ts** — `makeGhFetch({mode:"session"})` targets same-origin `/api/gh/*` and sets no `Authorization` header; `makeGhFetch({mode:"token"})` targets `api.github.com` and sets `Bearer`; the token never appears in the request URL. Assert this against a fake fetch that records every argument.
- **pr.ts** — URL resolution table (`/pull/123`, `/files`, `/commits/:sha`, trailing slash, non-github.com host rejected); faked fetch for file listing, filtering, and pagination.

The Pages Functions are covered by the allowlist and refresh paths being small pure helpers (`isAllowed(path)`, `shouldRefresh(status)`) tested directly; the handlers themselves stay thin enough to verify by hand.

## Known ceilings

Stated, not solved:

- **Moves.** Block LCS reports a moved section as one removal plus one addition. Detecting moves is a second pass over unmatched blocks — add it when moves actually get annoying.
- **Split view padding.** Aligned grid rows mean an asymmetric pair leaves whitespace on the shorter side.
- **Similarity threshold.** Whether two unmatched blocks are a `changed` pair or an independent add/remove is a tuned number. Expect to adjust it against real PRs.
- **A PAT is script-readable.** Accepted deliberately, bounded by fine-grained scope, short expiry, `sessionStorage` by default, and Method A being the default path. Two upgrades exist when it stops feeling acceptable: hold the token in a Web Worker so an XSS can use it but not steal it, and ship a CSP on the built file restricting `connect-src` and `form-action`. Neither is in Phase 1; the CSP is the cheaper of the two and only partial, since an image URL can still carry data out.

## Phase 2 preview

Not in scope, recorded so Phase 1 does not preclude it: selecting text in the rendered diff and leaving a review comment requires mapping that selection back to a source line number GitHub will accept. `Block.line` plus a per-block token offset makes that reachable. Approve and request-changes need `Pull requests: write` and a CSRF token on the proxy.
