<script lang="ts">
  import type { PrFile, PrFiles, PrInfo } from "../core/pr";
  import type { DiffDoc } from "../core/diff";
  import type { Layout, Scope } from "../state.svelte";

  interface Props {
    pr: PrInfo;
    files: PrFiles;
    active: PrFile | null;
    diff: DiffDoc | null;
    layout: Layout;
    scope: Scope;
    busy: boolean;
    changeIndex: number;
    changeCount: number;
    onFile: (f: PrFile) => void;
    onLayout: (l: Layout) => void;
    onScope: (s: Scope) => void;
    onStep: (delta: number) => void;
    onExit: () => void;
  }
  let {
    pr,
    files,
    active,
    diff,
    layout,
    scope,
    busy,
    changeIndex,
    changeCount,
    onFile,
    onLayout,
    onScope,
    onStep,
    onExit,
  }: Props = $props();

  const pick = (e: Event) => {
    const name = (e.currentTarget as HTMLSelectElement).value;
    const f = files.markdown.find((x) => x.filename === name);
    if (f) onFile(f);
  };
</script>

<div id="prbar">
  <div class="pr-line">
    <a class="pr-title" href={pr.url} target="_blank" rel="noopener">
      <span class="pr-num">{pr.owner}/{pr.repo}#{pr.number}</span>
      <span class="pr-name">{pr.title}</span>
    </a>
    <button class="pr-exit" onclick={onExit} title="Leave diff review">Close diff</button>
  </div>

  <div class="pr-line">
    <label class="pr-files">
      <span class="sr-only">Changed Markdown file</span>
      <select value={active?.filename ?? ""} onchange={pick} disabled={busy}>
        {#each files.markdown as f (f.filename)}
          <option value={f.filename}>
            {f.filename} &nbsp;+{f.additions} −{f.deletions}
          </option>
        {/each}
      </select>
    </label>

    {#if files.otherCount}
      <span class="pr-other">
        {files.otherCount} non-Markdown file{files.otherCount === 1 ? "" : "s"} not shown
      </span>
    {/if}

    <span class="spacer"></span>

    <div class="pr-seg" role="group" aria-label="Diff layout">
      <button class:sel={layout === "unified"} onclick={() => onLayout("unified")}>Unified</button>
      <button class:sel={layout === "split"} onclick={() => onLayout("split")}>Split</button>
    </div>

    <div class="pr-seg" role="group" aria-label="How much to show">
      <button class:sel={scope === "all"} onclick={() => onScope("all")}>Whole doc</button>
      <button class:sel={scope === "changed"} onclick={() => onScope("changed")}>
        Changes only
      </button>
    </div>

    <div class="pr-nav">
      <button onclick={() => onStep(-1)} disabled={!changeCount} title="Previous change (k)">
        ‹
      </button>
      <span class="pr-count">
        {#if changeCount}{changeIndex + 1} / {changeCount}{:else}no changes{/if}
      </span>
      <button onclick={() => onStep(1)} disabled={!changeCount} title="Next change (j)">›</button>
    </div>
  </div>

  {#if diff}
    <div class="pr-counts">
      <span class="c-add">+{diff.counts.added}</span>
      <span class="c-chg">~{diff.counts.changed}</span>
      <span class="c-del">−{diff.counts.removed}</span>
      <span class="c-note">blocks added, changed, removed</span>
    </div>
  {/if}
</div>
