# Readmark

An elegant, iOS-Books-style Markdown reader. Paste Markdown or point it at a GitHub URL, then read it your way — swappable paper themes, real typefaces, adjustable size/spacing/width, an auto outline, focus mode, and reading progress. No CDN, no tracking, and no server for anything you read from a file, a paste, or a public URL.

It also reviews the Markdown in a pull request. GitHub diffs Markdown line by line, so rewrapping a paragraph lights up every line of it; Readmark diffs by word inside rendered prose, so a three-word edit shows as three words. See [Reviewing a pull request](#reviewing-a-pull-request) — the one feature that does need a backend, and only if you want to sign in rather than paste a token.

Built with **Svelte 5** + **Vite 8**, linted/formatted with **Oxlint + oxfmt**, tested and tooled with **Bun**. Ships as a single self-contained `index.html`.

## Quick start

```bash
bun install
bun run dev        # Vite dev server + HMR
bun run build      # -> dist/index.html (everything inlined, self-contained)
bun test           # unit tests over the pure core
bun run check      # svelte-check type + a11y pass
bun run lint       # oxlint  (correctness=error, suspicious=warn)
bun run fmt        # oxfmt   (format in place; fmt:check to verify)
```

Config: [`.oxlintrc.json`](.oxlintrc.json), [`.oxfmtrc.json`](.oxfmtrc.json). `reference/` is
excluded from both via [`.prettierignore`](.prettierignore) so the prototype stays verbatim.

## Architecture

Designed as **deep modules**: a small, pure, framework-agnostic core, wrapped by a thin Svelte view tier. The interface _is_ the test surface — the core is exercised through its own interfaces with `bun test`, no browser required.

```
src/
├─ core/                 pure TypeScript — no DOM, no Svelte, no IO
│  ├─ markdown.ts        toHtml(src, {highlight}) -> { html, headings, title }
│  ├─ highlight.ts       highlight(code, lang) -> html  (single-scan tokenizer)
│  ├─ blocks.ts          splitBlocks(src) -> Block[]  (the shared block walker)
│  ├─ align.ts           align(before, after) -> Change[]  (rewrap-blind matching)
│  ├─ diff.ts            toDiffHtml(before, after) -> DiffDoc  (word-level marks)
│  ├─ source.ts          resolveGitHub(input) + fetchMarkdown(input, fetch)
│  ├─ pr.ts              resolvePR(url), listMarkdownFiles, fetchSides
│  ├─ token.ts           validate / load / save a pasted GitHub token
│  ├─ prefs.ts           coerce / load / save prefs against injected storage
│  ├─ reading.ts         reading-time, progress %, active heading, focus target
│  ├─ escape.ts, slug.ts small shared primitives
│  └─ *.test.ts          140+ tests, all pure in/out
├─ lib/theme.ts          theme / font / spacing / width option tables
├─ lib/gh.ts             makeGhFetch(auth) — session proxy vs. direct + Bearer
├─ state.svelte.ts       reactive store (runes) — glue only, delegates to core
├─ components/           TopBar · Outline · StatusBar · AaPanel · SourceModal
│                        AuthPanel · PrBar · DiffView
├─ App.svelte            layout + stage + scroll math (uses core/reading)
├─ app.css               the reading instrument's styling + 5 reading themes
└─ sample.md             the opening document

functions/api/           Cloudflare Pages Functions (only needed for sign-in)
├─ auth/*.ts             OAuth code exchange; token kept in an httpOnly cookie
├─ gh/[[path]].ts        read-only, allowlisted GET proxy to api.github.com
└─ _policy.ts            what is proxied, and the cookie rules — unit-tested
```

### Seams

Real seams (something varies across them → dependency-injected, faked in tests):

- **Network** — `fetchMarkdown` takes a `fetch` function.
- **Storage** — prefs take a `StorageLike` (localStorage in the app, in-memory in tests).
- **Source** — paste vs GitHub, resolved through one `resolveGitHub` interface.

- **Credentials** — `makeGhFetch(auth)` returns the same `FetchLike` whether the request rides a signed-in session or a pasted token, so `core/pr.ts` never branches on it.

Internal seams: the Markdown parser takes `highlight` as an injected dependency, so it can be tested with a fake highlighter; and `core/blocks.ts` is the one definition of a block, shared by the renderer and the differ.

## Reviewing a pull request

Paste a pull request URL into **Open → Pull request**. Readmark lists the Markdown files the PR touches, fetches both sides of the one you pick, and renders the change:

- **Unified** — the document, with deletions struck through and insertions highlighted in place.
- **Split** — before and after side by side, each column marking only its own half of the edit.
- **Whole doc / Changes only** — collapse the untouched blocks when you just want the edits.
- `j` and `k` jump between changes. On a long README with three changed words, that is the whole review.
- **Commit range** — the commits chip narrows the diff to a run of commits, or to everything since your last review. A range is read as "the parent of the first commit against the last", which is the work those commits did; the file list is recomputed for the range, since a file touched outside it is not part of that view.

A file that exists on only one side — newly added, or deleted — is not washed in colour at all. Marking every block would say nothing; the view states the fact once at the top and lets you read the document.

Rewrapping is invisible: blocks are matched on their words with whitespace collapsed, so a reflowed paragraph is the same paragraph. Code blocks, raw HTML, and edits that change a block's structure (a bullet list turned numbered) are flagged whole rather than word-marked, because word marks there would be misleading.

### Access

Two ways to authenticate, and they are not equivalent:

|                                      | Reads org-owned private repos               | Approved by  |
| ------------------------------------ | ------------------------------------------- | ------------ |
| **Sign in with GitHub** (GitHub App) | Once the app is installed on that org       | An org owner |
| **Fine-grained token**               | Only if the org enables fine-grained tokens | An org owner |
| **Classic token**                    | Unless the org restricts classic tokens     | You          |

**Sign-in is not switched on yet.** No GitHub App is registered, so a token is the way in. The session path — the Pages Functions, the httpOnly cookies, the refresh — is written and unit-tested; re-enabling it is `SIGN_IN_ENABLED` in [`src/lib/gh.ts`](src/lib/gh.ts) once an App exists. That one flag governs the lot: no startup probe, no session preferred over your token, no sign-in UI. The `/api/auth/login` route independently returns 404 while `GH_CLIENT_ID` is unset, so the callback is closed rather than merely unlinked. When it is on, signing in is the safer route: the credential lives in a cookie that page scripts cannot read.

A pasted token is the way in today, and the fallback thereafter — it is the only way pull requests work in the offline single-file build or a self-hosted copy. Prefer a fine-grained token with **Contents: read** and **Pull requests: read**, scoped to the repositories you review. It is stored in `sessionStorage` unless you tick _remember on this device_, and it only ever travels as an `Authorization` header to `api.github.com`.

Be aware of the trade: a stored token is readable by any script running on the page, and this app renders Markdown written by other people. Keep its scope small and its expiry short. Note also that a classic token has no read-only private scope — it carries write access to everything you can reach, which is why it is the least good option despite being the one that needs nobody's permission.

## Build target

`vite-plugin-singlefile` inlines all JS + CSS into one `dist/index.html`. The same
file works as a local double-click, a static host, and a CSP-locked embed — no
external requests. GitHub fetching works wherever the network isn't sandboxed
(GitHub's raw + API endpoints send permissive CORS headers).

## Deploy

CI/CD lives in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml): every push to
`main` installs, lints, tests, builds, and deploys `dist/` to **Cloudflare Pages**
(project `readmark` → `https://readmark.pages.dev`).

Pull-request sign-in additionally needs a GitHub App (permissions **Contents: read** and **Pull requests: read**, callback `https://<origin>/api/auth/callback`) and two encrypted Pages environment variables, `GH_CLIENT_ID` and `GH_CLIENT_SECRET`. Without them the app still runs — reading and pasting work as before, and pull requests fall back to a pasted token.

Run the Functions locally with:

```bash
wrangler pages dev --proxy 5173 -- bun run dev
```

Requires two repository secrets (Settings → Secrets → Actions):

- `CLOUDFLARE_API_TOKEN` — a token with the **Cloudflare Pages: Edit** permission
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account id

```bash
gh secret set CLOUDFLARE_API_TOKEN  -R aphisak-w-mohara/readmark
gh secret set CLOUDFLARE_ACCOUNT_ID -R aphisak-w-mohara/readmark
```

## Reference

The original single-file prototype is preserved under [`reference/`](reference/).
