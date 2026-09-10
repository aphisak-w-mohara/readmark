<script lang="ts">
  import type { DiffDoc, DiffRow } from "../core/diff";
  import type { Layout, Scope } from "../state.svelte";

  interface Props {
    diff: DiffDoc;
    layout: Layout;
    scope: Scope;
  }
  let { diff, layout, scope }: Props = $props();

  /** Runs of untouched blocks collapse into one spacer the reader can open. */
  interface Fold {
    kind: "fold";
    rows: DiffRow[];
    from: number;
  }
  type Item = { kind: "row"; row: DiffRow; index: number } | Fold;

  let opened = $state(new Set<number>());

  // Reset the expanded folds whenever a different document is shown.
  $effect(() => {
    // oxlint-disable-next-line no-unused-expressions -- track the document identity
    diff;
    opened = new Set();
  });

  const items = $derived.by((): Item[] => {
    const out: Item[] = [];
    if (scope === "all") {
      diff.rows.forEach((row, index) => out.push({ kind: "row", row, index }));
      return out;
    }
    let run: DiffRow[] = [];
    let runStart = 0;
    const flush = () => {
      if (!run.length) return;
      // A heading immediately before a change is context worth keeping.
      const trailing = run[run.length - 1];
      const keepHeading = trailing?.kind === "heading";
      const folded = keepHeading ? run.slice(0, -1) : run;
      if (folded.length) out.push({ kind: "fold", rows: folded, from: runStart });
      if (keepHeading) out.push({ kind: "row", row: trailing, index: runStart + folded.length });
      run = [];
    };
    diff.rows.forEach((row, index) => {
      if (row.op === "same") {
        if (!run.length) runStart = index;
        run.push(row);
      } else {
        flush();
        out.push({ kind: "row", row, index });
      }
    });
    flush();
    return out;
  });

  const label = (n: number) => `${n} unchanged block${n === 1 ? "" : "s"}`;
</script>

{#if layout === "unified"}
  {#each items as item (item.kind === "row" ? "r" + item.index : "f" + item.from)}
    {#if item.kind === "fold"}
      {#if opened.has(item.from)}
        {#each item.rows as row, i (i)}
          <div class="diff-row" data-op="same">{@html row.unified}</div>
        {/each}
      {:else}
        <button class="diff-fold" onclick={() => (opened = new Set([...opened, item.from]))}>
          ⋯ {label(item.rows.length)}
        </button>
      {/if}
    {:else}
      <div class="diff-row" data-op={item.row.op} data-marked={item.row.marked}>
        {@html item.row.unified}
      </div>
    {/if}
  {/each}
{:else}
  <div class="diff-split">
    <div class="diff-col-head">Before</div>
    <div class="diff-col-head">After</div>
    {#each items as item (item.kind === "row" ? "r" + item.index : "f" + item.from)}
      {#if item.kind === "fold"}
        {#if opened.has(item.from)}
          {#each item.rows as row, i (i)}
            <div class="diff-side" data-op="same">{@html row.before}</div>
            <div class="diff-side" data-op="same">{@html row.after}</div>
          {/each}
        {:else}
          <button
            class="diff-fold span"
            onclick={() => (opened = new Set([...opened, item.from]))}
          >
            ⋯ {label(item.rows.length)}
          </button>
        {/if}
      {:else}
        <div class="diff-side" data-op={item.row.op === "added" ? "absent" : item.row.op}>
          {#if item.row.op === "added"}<span class="diff-absent">—</span>{:else}{@html item.row
              .before}{/if}
        </div>
        <div class="diff-side" data-op={item.row.op === "removed" ? "absent" : item.row.op}>
          {#if item.row.op === "removed"}<span class="diff-absent">—</span>{:else}{@html item.row
              .after}{/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}
