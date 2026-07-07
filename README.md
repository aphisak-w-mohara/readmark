# Codex

An elegant, iOS-Books-style Markdown reader. Paste Markdown or point it at a GitHub URL, then read it your way — swappable paper themes, real typefaces, adjustable size/spacing/width, an auto outline, focus mode, and reading progress. No server, no CDN, no tracking.

Built with **Svelte 5** + **Vite**, tested and tooled with **Bun**. Ships as a single self-contained `index.html`.

## Quick start

```bash
bun install
bun run dev        # Vite dev server + HMR
bun run build      # -> dist/index.html (everything inlined, self-contained)
bun test           # unit tests over the pure core
bun run check      # svelte-check type + a11y pass
```

## Architecture

Designed as **deep modules**: a small, pure, framework-agnostic core, wrapped by a thin Svelte view tier. The interface *is* the test surface — the core is exercised through its own interfaces with `bun test`, no browser required.

```
src/
├─ core/                 pure TypeScript — no DOM, no Svelte, no IO
│  ├─ markdown.ts        toHtml(src, {highlight}) -> { html, headings, title }
│  ├─ highlight.ts       highlight(code, lang) -> html  (single-scan tokenizer)
│  ├─ source.ts          resolveGitHub(input) + fetchMarkdown(input, fetch)
│  ├─ prefs.ts           coerce / load / save prefs against injected storage
│  ├─ reading.ts         reading-time, progress %, active heading, focus target
│  ├─ escape.ts, slug.ts small shared primitives
│  └─ *.test.ts          41 tests, all pure in/out
├─ lib/theme.ts          theme / font / spacing / width option tables
├─ state.svelte.ts       reactive store (runes) — glue only, delegates to core
├─ components/           TopBar · Outline · StatusBar · AaPanel · SourceModal
├─ App.svelte            layout + stage + scroll math (uses core/reading)
├─ app.css               the reading instrument's styling + 5 reading themes
└─ sample.md             the opening document
```

### Seams

Real seams (something varies across them → dependency-injected, faked in tests):

- **Network** — `fetchMarkdown` takes a `fetch` function.
- **Storage** — prefs take a `StorageLike` (localStorage in the app, in-memory in tests).
- **Source** — paste vs GitHub, resolved through one `resolveGitHub` interface.

Internal seam: the Markdown parser takes `highlight` as an injected dependency, so it can be tested with a fake highlighter.

## Build target

`vite-plugin-singlefile` inlines all JS + CSS into one `dist/index.html`. The same
file works as a local double-click, a static host, and a CSP-locked embed — no
external requests. GitHub fetching works wherever the network isn't sandboxed
(GitHub's raw + API endpoints send permissive CORS headers).

## Reference

The original single-file prototype is preserved under [`reference/`](reference/).
