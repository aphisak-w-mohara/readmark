<script lang="ts">
  import type { PrFile, PrFiles } from "../core/pr";
  import type { Layout, Scope } from "../state.svelte";

  interface Props {
    files: PrFiles;
    commitCount: number;
    rangeCount: number;
    active: PrFile | null;
    layout: Layout;
    scope: Scope;
    busy: boolean;
    /** False when the file exists on only one side — nothing to put beside it. */
    comparable: boolean;
    changeIndex: number;
    changeCount: number;
    onFile: (f: PrFile) => void;
    onLayout: (l: Layout) => void;
    onScope: (s: Scope) => void;
    onStep: (delta: number) => void;
    onCommits: () => void;
    onExit: () => void;
  }
  let {
    files,
    commitCount,
    rangeCount,
    active,
    layout,
    scope,
    busy,
    comparable,
    changeIndex,
    changeCount,
    onFile,
    onLayout,
    onScope,
    onStep,
    onCommits,
    onExit,
  }: Props = $props();

  const pick = (e: Event) => {
    const name = (e.currentTarget as HTMLSelectElement).value;
    const f = files.markdown.find((x) => x.filename === name);
    if (f) onFile(f);
  };

  // A native select keeps keyboard and touch behaviour; only its skin changes.
  const short = (path: string) => path.split("/").pop() ?? path;

  const note = $derived(
    [
      files.markdown.length > 1 ? `${files.markdown.length} Markdown files` : "",
      files.otherCount ? `${files.otherCount} other` : "",
      rangeCount ? "commenting needs all commits" : "",
    ]
      .filter(Boolean)
      .join(" · "),
  );
</script>

<div id="prbar">
  <label class="pr-file" class:busy>
    <span class="sr-only">Changed Markdown file</span>
    <!-- `selected` per option rather than `value` on the select: the value
         is applied before the options exist, so it silently does not stick
         and the native menu opens with nothing current. -->
    <select onchange={pick} disabled={busy}>
      {#each files.markdown as f (f.filename)}
        <option value={f.filename} selected={f.filename === active?.filename}>
          {short(f.filename)}
        </option>
      {/each}
    </select>
    <span class="pr-file-face" aria-hidden="true">
      <span class="pr-file-name">{active ? short(active.filename) : "—"}</span>
      {#if active}
        <span class="pr-add">+{active.additions}</span>
        <span class="pr-del">−{active.deletions}</span>
      {/if}
      <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
    </span>
  </label>

  {#if commitCount}
    <button
      class="pr-commits"
      class:ranged={rangeCount > 0}
      onclick={onCommits}
      title="Choose which commits to view"
    >
      {#if rangeCount}{rangeCount} of {commitCount} commits{:else}{commitCount} commits{/if}
      <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
    </button>
  {/if}

  {#if note}
    <span class="pr-note">{note}</span>
  {/if}

  <span class="pr-spacer"></span>

  <div class="pr-seg" class:off={!comparable} role="group" aria-label="Diff layout">
    <button
      class:sel={layout === "unified" && comparable}
      onclick={() => onLayout("unified")}
      disabled={!comparable}
      title={comparable ? "Unified — one column" : "This file exists on one side only"}
      aria-label="Unified layout"
      aria-pressed={layout === "unified"}
    >
      <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16" /></svg>
    </button>
    <button
      class:sel={layout === "split" && comparable}
      onclick={() => onLayout("split")}
      disabled={!comparable}
      title={comparable ? "Split — before and after" : "This file exists on one side only"}
      aria-label="Split layout"
      aria-pressed={layout === "split"}
    >
      <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M12 4v16" /></svg>
    </button>
  </div>

  <div class="pr-seg" class:off={!comparable} role="group" aria-label="How much to show">
    <button
      class:sel={scope === "all" && comparable}
      onclick={() => onScope("all")}
      disabled={!comparable}
      title={comparable ? "Whole document" : "Every block is a change here"}
      aria-label="Show the whole document"
      aria-pressed={scope === "all"}
    >
      <svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z" /><path d="M9 12h6M9 16h6" /></svg>
    </button>
    <button
      class:sel={scope === "changed" && comparable}
      onclick={() => onScope("changed")}
      disabled={!comparable}
      title={comparable ? "Changes only" : "Every block is a change here"}
      aria-label="Show changes only"
      aria-pressed={scope === "changed"}
    >
      <svg viewBox="0 0 24 24"><path d="M4 5h16l-6 7v6l-4 2v-8z" /></svg>
    </button>
  </div>

  <div class="pr-nav">
    <button onclick={() => onStep(-1)} disabled={!changeCount} title="Previous change (k)" aria-label="Previous change">
      <svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" /></svg>
    </button>
    <span class="pr-count">
      {#if changeCount}{changeIndex + 1}/{changeCount}{:else}none{/if}
    </span>
    <button onclick={() => onStep(1)} disabled={!changeCount} title="Next change (j)" aria-label="Next change">
      <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" /></svg>
    </button>
  </div>

  <button class="pr-close" onclick={onExit} title="Leave diff review" aria-label="Leave diff review">
    <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
  </button>
</div>
