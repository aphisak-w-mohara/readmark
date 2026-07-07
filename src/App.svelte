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

  let stageEl = $state<HTMLElement>();
  let articleEl = $state<HTMLElement>();

  let progress = $state(0);
  let activeId = $state<string | null>(null);
  let words = $state(0);

  let aaOpen = $state(false);
  let sourceOpen = $state(false);

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // opening document
  store.load(SAMPLE);

  // outline + scrollspy track headings down to level 4 (matches the CSS depth)
  const outline = $derived(store.doc.headings.filter((h: Heading) => h.level <= 4));
  const minutes = $derived(readingTime(words));
  const readStyle = $derived(
    `--read-font:${fontCss(store.prefs.font)};--read-size:${store.prefs.size}px;--read-lh:${store.prefs.spacing};--measure:${store.prefs.width}`,
  );

  // delegate code-block "Copy" clicks off the article (survives {@html} swaps)
  $effect(() => {
    const el = articleEl;
    if (!el) return;
    el.addEventListener("click", onCopy);
    return () => el.removeEventListener("click", onCopy);
  });

  // recount + reset scroll after each new document paints into {@html}
  $effect(() => {
    // oxlint-disable-next-line no-unused-expressions -- read tracks doc changes for this effect
    store.doc.html;
    queueMicrotask(() => {
      if (articleEl) words = countWords(articleEl.textContent || "");
      if (stageEl) stageEl.scrollTop = 0;
      onScroll();
      if (store.focus) updateFocus();
    });
  });

  function headingTops() {
    return outline.map((h) => {
      const el = document.getElementById(h.id);
      return { id: h.id, top: el ? el.offsetTop : 0 };
    });
  }

  function onScroll() {
    if (!stageEl) return;
    const st = stageEl.scrollTop;
    const max = stageEl.scrollHeight - stageEl.clientHeight;
    progress = progressPct(st, stageEl.scrollHeight, stageEl.clientHeight);
    const tops = headingTops();
    let id = activeHeadingId(tops, st + 80);
    if (max - st < 4 && tops.length) id = tops[tops.length - 1].id;
    activeId = id;
    if (store.focus) updateFocus();
  }

  function updateFocus() {
    if (!articleEl || !stageEl) return;
    const blocks = [
      ...articleEl.querySelectorAll<HTMLElement>(
        ":scope > p, :scope > ul, :scope > ol, :scope > blockquote, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > .codeblock, :scope > .table-wrap",
      ),
    ];
    const center = stageEl.scrollTop + stageEl.clientHeight / 2;
    const centers = blocks.map((b) => b.offsetTop + b.offsetHeight / 2);
    const idx = focusTargetIndex(centers, center);
    blocks.forEach((b, i) => b.classList.toggle("focus-live", i === idx));
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

  function toggleFocus() {
    store.toggleFocus();
    if (store.focus) queueMicrotask(updateFocus);
    else articleEl?.querySelectorAll(".focus-live").forEach((b) => b.classList.remove("focus-live"));
  }

  function closePanels() {
    aaOpen = false;
    sourceOpen = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") closePanels();
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  id="app"
  data-theme={store.prefs.theme}
  class:no-outline={!store.outlineOpen}
  class:focus={store.focus}
  style={readStyle}
>
  <div id="progress" style="width:{progress}%"></div>

  <TopBar
    title={store.doc.title}
    outlineOpen={store.outlineOpen}
    focus={store.focus}
    onSource={() => (sourceOpen = true)}
    onToggleOutline={() => store.toggleOutline()}
    onAa={() => (aaOpen = !aaOpen)}
    onToggleFocus={toggleFocus}
  />

  <div id="body">
    <Outline headings={outline} {activeId} onJump={jump} />
    <main id="stage" bind:this={stageEl} onscroll={onScroll}>
      <div class="page-wrap">
        <article id="page" class="md" class:focusing={store.focus} bind:this={articleEl}>
          {@html store.doc.html}
        </article>
      </div>
    </main>
  </div>

  <StatusBar title={store.doc.title} {words} {minutes} pct={Math.round(progress)} />

  <AaPanel open={aaOpen} />
  <SourceModal open={sourceOpen} onClose={() => (sourceOpen = false)} onRender={(md) => store.load(md)} />

  <div id="scrim" class:show={aaOpen || sourceOpen} onclick={closePanels} role="presentation"></div>
</div>
