<script lang="ts">
  import { store } from "./state.svelte";
  import { fontCss } from "./lib/theme";
  import { progressPct, activeHeadingId, focusTargetIndex, countWords, readingTime } from "./core/reading";
  import type { Heading } from "./core/markdown";
  import SAMPLE from "./sample.md?raw";
  import TopBar from "./components/TopBar.svelte";
  import Outline from "./components/Outline.svelte";
  import StatusBar from "./components/StatusBar.svelte";
  import AaPanel from "./components/AaPanel.svelte";
  import SourceModal from "./components/SourceModal.svelte";
  import PrBar from "./components/PrBar.svelte";
  import DiffView from "./components/DiffView.svelte";
  import CommitPicker from "./components/CommitPicker.svelte";
  import ReviewBar from "./components/ReviewBar.svelte";
  import type { PrFile } from "./core/pr";
  import type { Scope } from "./state.svelte";

  let stageEl = $state<HTMLElement>();
  let diffView = $state<DiffView>();
  let articleEl = $state<HTMLElement>();

  let progress = $state(0);
  let activeId = $state<string | null>(null);
  let words = $state(0);

  let aaOpen = $state(false);
  let sourceOpen = $state(false);
  let commitsOpen = $state(false);

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // opening document
  store.load(SAMPLE);

  // Does this origin have a sign-in backend? A static build does not.
  store.checkSession();

  let changeIndex = $state(0);

  // outline + scrollspy track headings down to level 4 (matches the CSS depth)
  const outline = $derived(store.doc.headings.filter((h: Heading) => h.level <= 4));
  const minutes = $derived(readingTime(words));
  const readStyle = $derived(
    `--read-font:${fontCss(store.prefs.font)};--read-size:${store.prefs.size}px;--read-lh:${store.prefs.spacing};--measure:${store.prefs.width}`,
  );
  const isDark = $derived(store.prefs.theme === "night" || store.prefs.theme === "black");

  // Reflect the document name in the tab title so multiple open tabs are easy to tell apart.
  $effect(() => {
    const t = store.doc.title;
    document.title =
      t && t !== "Untitled" && t !== "Readmark"
        ? `${t} · Readmark`
        : "Readmark — a reading room for Markdown";
  });

  // Render any ```mermaid blocks into SVG. Lazy-imports mermaid so the library
  // only loads when a document actually contains a diagram.
  let mermaidSeq = 0;
  async function renderMermaid(dark: boolean) {
    if (!articleEl) return;
    const blocks = [...articleEl.querySelectorAll<HTMLElement>(".mermaid")];
    if (!blocks.length) return;
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      theme: dark ? "dark" : "neutral",
      securityLevel: "strict",
      fontFamily: "inherit",
    });
    for (const el of blocks) {
      const code = el.dataset.src ?? el.querySelector(".mermaid-src")?.textContent ?? "";
      el.dataset.src = code;
      try {
        const { svg } = await mermaid.render("mmd-" + mermaidSeq++, code);
        el.innerHTML = svg;
      } catch (err) {
        el.textContent = "";
        const pre = document.createElement("pre");
        pre.className = "mermaid-error";
        pre.textContent = "Mermaid error: " + (err instanceof Error ? err.message : String(err));
        el.append(pre);
      }
    }
  }

  // (re)render diagrams whenever the document changes or the light/dark theme flips
  $effect(() => {
    // oxlint-disable-next-line no-unused-expressions -- track doc + theme for diagram rendering
    store.doc.html;
    const dark = isDark;
    queueMicrotask(() => renderMermaid(dark));
  });

  // delegate code-block "Copy" clicks off the article (survives {@html} swaps)
  $effect(() => {
    const el = articleEl;
    if (!el) return;
    el.addEventListener("click", onCopy);
    return () => el.removeEventListener("click", onCopy);
  });

  const FOCUS_SEL =
    ":scope > p, :scope > ul, :scope > ol, :scope > blockquote, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > .codeblock, :scope > .table-wrap, :scope > .mermaid";

  // Cached layout measurements so the scroll handler never reads layout per
  // event — critical on very large documents (thousands of headings/blocks).
  let headingTops: { id: string; top: number }[] = [];
  let focusBlocks: HTMLElement[] = [];
  let focusCenters: number[] = [];

  function measure() {
    if (!articleEl) return;
    headingTops = outline.map((h) => {
      const el = document.getElementById(h.id);
      return { id: h.id, top: el ? el.offsetTop : 0 };
    });
    if (store.zen) {
      focusBlocks = [...articleEl.querySelectorAll<HTMLElement>(FOCUS_SEL)];
      focusCenters = focusBlocks.map((b) => b.offsetTop + b.offsetHeight / 2);
    }
  }

  // recount + reset scroll + remeasure after each new document paints into {@html}
  $effect(() => {
    // oxlint-disable-next-line no-unused-expressions -- read tracks doc changes for this effect
    store.doc.html;
    queueMicrotask(() => {
      if (articleEl) words = countWords(articleEl.textContent || "");
      if (stageEl) stageEl.scrollTop = 0;
      measure();
      applyScroll();
    });
  });

  // remeasure when layout-affecting state changes (typography, width, rails, zen)
  $effect(() => {
    // oxlint-disable-next-line no-unused-expressions -- track layout-affecting state
    [readStyle, store.outlineOpen, store.zen];
    queueMicrotask(() => {
      measure();
      applyScroll();
    });
  });

  let scrollScheduled = false;
  function onScroll() {
    if (scrollScheduled) return;
    scrollScheduled = true;
    requestAnimationFrame(() => {
      scrollScheduled = false;
      applyScroll();
    });
  }

  function applyScroll() {
    if (!stageEl) return;
    const st = stageEl.scrollTop;
    const max = stageEl.scrollHeight - stageEl.clientHeight;
    progress = progressPct(st, stageEl.scrollHeight, stageEl.clientHeight);
    let id = activeHeadingId(headingTops, st + 80);
    if (max - st < 4 && headingTops.length) id = headingTops[headingTops.length - 1].id;
    activeId = id;
    if (store.zen) {
      const idx = focusTargetIndex(focusCenters, st + stageEl.clientHeight / 2);
      focusBlocks.forEach((b, i) => b.classList.toggle("focus-live", i === idx));
    }
  }

  function onResize() {
    measure();
    applyScroll();
  }

  /**
   * The elements `j`/`k` step through — one per changed row, in row order.
   * Split renders a changed row on both sides, so only the after side is
   * taken: this list shares `changeIndex` with `changeRows` and the two
   * drifting is what sends `c` to the wrong block.
   */
  function changeEls(): HTMLElement[] {
    if (!articleEl || !changeCount) return [];
    return [
      ...articleEl.querySelectorAll<HTMLElement>(
        '.diff-row:not([data-op="same"]), .diff-side.is-after[data-op="changed"], .diff-side[data-op="added"], .diff-side[data-op="removed"]',
      ),
    ];
  }

  /**
   * Bring change `i` into view. Measured from bounding rects rather than
   * offsetTop: a diff row's offsetParent is not the stage, so its
   * offsetTop is in a different coordinate space and lands nowhere near.
   */
  function scrollToChange(i: number) {
    const els = changeEls();
    const el = els[i];
    if (!el || !stageEl) return;
    const top =
      stageEl.scrollTop + el.getBoundingClientRect().top - stageEl.getBoundingClientRect().top - 80;
    stageEl.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function stepChange(delta: number) {
    const els = changeEls();
    if (!els.length) return;
    changeIndex = (changeIndex + delta + els.length) % els.length;
    scrollToChange(changeIndex);
  }

  function jump(id: string) {
    const el = document.getElementById(id);
    if (!el || !stageEl) return;
    stageEl.scrollTo({ top: el.offsetTop - 40, behavior: reduceMotion ? "auto" : "smooth" });
  }

  function onCopy(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".copybtn");
    if (!btn) return;
    const code = btn.closest(".codeblock")?.querySelector("code")?.textContent ?? "";
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        btn.textContent = "Copied";
        btn.classList.add("done");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("done");
        }, 1400);
      })
      .catch(() => {});
  }

  let peek = $state(false);
  let peekTimer: ReturnType<typeof setTimeout> | undefined;

  function toggleZen() {
    store.toggleZen();
    // entering Zen: the layout effect remeasures + lights the current block.
    if (!store.zen) {
      peek = false;
      articleEl?.querySelectorAll(".focus-live").forEach((b) => b.classList.remove("focus-live"));
    }
  }

  // In Zen there's no chrome, so reveal the exit affordance briefly on pointer movement.
  function onMove() {
    if (!store.zen) return;
    peek = true;
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => (peek = false), 2000);
  }

  function closePanels() {
    aaOpen = false;
    sourceOpen = false;
    commitsOpen = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (aaOpen || sourceOpen || commitsOpen) closePanels();
      else if (store.zen) toggleZen();
      return;
    }
    // j/k step between changes, but never while something is being typed into.
    if (store.mode !== "diff" || aaOpen || sourceOpen || commitsOpen) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (e.key === "j") stepChange(1);
    else if (e.key === "k") stepChange(-1);
    // `c` comments on the change the cursor is already on, rather than
    // re-deriving "what am I looking at" from layout reads.
    else if (e.key === "c") {
      const row = changeRows[changeIndex];
      if (row) {
        e.preventDefault();
        // The editor takes focus, so it has to be somewhere you can see:
        // the cursor may be far off-screen when `c` is pressed.
        scrollToChange(changeIndex);
        diffView?.openComment(row);
      }
    }
  }

  /**
   * The rows `j`/`k` step through and `c` comments on, in document order.
   * A wholly new or deleted file has no untouched rows to exclude, so it
   * yields all of them — every block there takes a comment, and the
   * keyboard should reach what the mouse can.
   */
  const changeRows = $derived(store.diff ? store.diff.rows.filter((r) => r.op !== "same") : []);
  const changeCount = $derived(changeRows.length);

  // How many commits the current range covers; 0 means the whole PR.
  const rangeCount = $derived.by(() => {
    const r = store.range;
    if (!r) return 0;
    const a = store.commits.findIndex((c) => c.sha === r.fromSha);
    const b = store.commits.findIndex((c) => c.sha === r.toSha);
    return a >= 0 && b >= 0 ? b - a + 1 : 0;
  });

  async function pickFile(f: PrFile) {
    changeIndex = 0;
    await store.openFile(f);
  }

  // Collapsing the untouched blocks moves everything; start from the top
  // rather than leaving the reader parked wherever the old offset landed.
  function setScope(s: Scope) {
    if (s === store.scope) return;
    store.scope = s;
    changeIndex = 0;
    queueMicrotask(() => {
      if (stageEl) stageEl.scrollTop = 0;
    });
  }
</script>

<svelte:window onkeydown={onKey} onmousemove={onMove} onresize={onResize} />

<div
  id="app"
  data-theme={store.prefs.theme}
  class:no-outline={!store.outlineOpen}
  class:zen={store.zen}
  style={readStyle}
>
  <div id="progress" style="width:{progress}%"></div>

  <TopBar
    title={store.doc.title}
    pr={store.mode === "diff" && store.pr
      ? {
          label: `${store.pr.owner}/${store.pr.repo}#${store.pr.number}`,
          subject: store.pr.title,
          url: store.pr.url,
        }
      : null}
    outlineOpen={store.outlineOpen}
    zen={store.zen}
    onSource={() => (sourceOpen = true)}
    onToggleOutline={() => store.toggleOutline()}
    onAa={() => (aaOpen = !aaOpen)}
    onToggleZen={toggleZen}
  />

  {#if store.mode === "diff" && store.pr && store.files}
    <PrBar
      files={store.files}
      active={store.activeFile}
      layout={store.layout}
      scope={store.scope}
      busy={store.busy}
      comparable={!store.diff?.whole}
      {changeIndex}
      {changeCount}
      commitCount={store.commits.length}
      {rangeCount}
      onCommits={() => (commitsOpen = true)}
      onFile={pickFile}
      onLayout={(l) => (store.layout = l)}
      onScope={setScope}
      onStep={stepChange}
      onExit={() => store.load(SAMPLE)}
    />
  {/if}

  <div id="body">
    <Outline headings={outline} {activeId} onJump={jump} />
    <main id="stage" bind:this={stageEl} onscroll={onScroll}>
      <div class="page-wrap">
        <article
          id="page"
          class="md"
          class:focusing={store.zen}
          class:diffing={store.mode === "diff"}
          bind:this={articleEl}
        >
          {#if store.mode === "diff" && store.diff}
            <DiffView
              bind:this={diffView}
              diff={store.diff}
              layout={store.layout}
              scope={store.scope}
              path={store.activeFile?.filename ?? null}
              draft={store.draft}
              busy={store.submitting}
              onSave={(a, b) => store.setComment(a, b)}
              onPostNow={(a, b) => store.postOne(a, b)}
            />
          {:else}
            {@html store.doc.html}
          {/if}
        </article>
      </div>
    </main>
  </div>

  {#if store.mode === "diff" && store.commenting && (store.draft.length || store.submitted || store.reviewError)}
    <ReviewBar
      count={store.draft.length}
      busy={store.submitting}
      error={store.reviewError}
      submitted={store.submitted}
      onSubmit={(e, summary) => store.submitReview(e, summary)}
      onDismiss={() => {
        store.reviewError = null;
        store.submitted = null;
      }}
    />
  {/if}

  <StatusBar title={store.doc.title} {words} {minutes} pct={Math.round(progress)} />

  <AaPanel open={aaOpen} />
  <SourceModal
    open={sourceOpen}
    onClose={() => (sourceOpen = false)}
    onRender={(md) => store.load(md)}
    onPr={(url) => store.openPr(url)}
    available={store.session.available}
    signedIn={store.session.signedIn}
    token={store.token}
    onToken={(t, r) => store.setToken(t, r)}
    onForget={() => store.forgetToken()}
  />

  <CommitPicker
    open={commitsOpen}
    commits={store.commits}
    range={store.range}
    lastReviewSha={store.lastReviewSha}
    onClose={() => (commitsOpen = false)}
    onApply={(r) => {
      changeIndex = 0;
      store.setRange(r);
    }}
  />

  <div id="scrim" class:show={aaOpen || sourceOpen || commitsOpen} onclick={closePanels} role="presentation"></div>

  {#if store.zen}
    <button id="zenexit" class:peek onclick={toggleZen} title="Exit Zen (Esc)" aria-label="Exit Zen mode">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>Exit Zen
    </button>
    <div id="zenhint">Press <b>Esc</b> to exit Zen</div>
  {/if}
</div>
