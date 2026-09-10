<script lang="ts">
  import type { DiffDoc, DiffRow } from "../core/diff";
  import type { Layout, Scope } from "../state.svelte";
  import type { Anchor, DraftComment } from "../core/review";
  import { anchorKey } from "../core/review";
  import CommentBox from "./CommentBox.svelte";

  interface Props {
    diff: DiffDoc;
    layout: Layout;
    scope: Scope;
    /** Null while there is nothing to comment on (no PR file open). */
    path?: string | null;
    draft?: DraftComment[];
    busy?: boolean;
    onSave?: (anchor: Anchor, body: string) => void;
    onPostNow?: (anchor: Anchor, body: string) => void;
  }
  let {
    diff,
    layout,
    scope,
    path = null,
    draft = [],
    busy = false,
    onSave,
    onPostNow,
  }: Props = $props();

  /** Which anchor has the editor open, by key; only ever one at a time. */
  let openKey = $state<string | null>(null);

  const keyOf = (a: Anchor) => (path ? anchorKey(path, a) : "");
  const bodyAt = (a: Anchor) =>
    path ? (draft.find((c) => anchorKey(c.path, c) === anchorKey(path, a))?.body ?? "") : "";
  const hasComment = (a: Anchor | null) => Boolean(a && bodyAt(a));

  // A different document means the editor's anchor no longer exists.
  $effect(() => {
    // oxlint-disable-next-line no-unused-expressions -- track the document
    diff;
    openKey = null;
  });

  /**
   * `c` comments on what you are looking at: the first commentable block
   * showing in the stage. Self-contained here — the alternative is
   * plumbing the change cursor down from App for one keystroke.
   */
  function onKey(e: KeyboardEvent) {
    if (e.key !== "c" || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!path || !onSave || openKey) return;
    const btn = [...document.querySelectorAll<HTMLElement>(".diff-add")].find((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight * 0.8;
    });
    if (!btn) return;
    e.preventDefault();
    btn.click();
  }

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

  // A file that exists on only one side has nothing to compare against, so
  // it reads as the document it is, with the fact stated once at the top.
  const banner = $derived(
    diff.whole === "added"
      ? `New file — all ${diff.rows.length} block${diff.rows.length === 1 ? "" : "s"} are new.`
      : diff.whole === "removed"
        ? `File deleted — this is the version that was removed.`
        : null,
  );
</script>

{#if banner}
  <p class="diff-banner" data-whole={diff.whole}>{banner}</p>
{/if}

<svelte:window onkeydown={onKey} />

{#if diff.whole}
  {#each diff.rows as row, i (i)}
    <div class="diff-row">{@html diff.whole === "removed" ? row.before : row.after}</div>
  {/each}
{:else if layout === "unified"}
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
        {#if item.row.anchor && path && onSave}
          {@const a = item.row.anchor}
          <button
            class="diff-add"
            class:has={hasComment(a)}
            title={hasComment(a) ? "Edit your comment" : "Comment on this block"}
            aria-label={hasComment(a) ? "Edit your comment" : "Comment on this block"}
            onclick={() => (openKey = openKey === keyOf(a) ? null : keyOf(a))}
          >
            {hasComment(a) ? "●" : "+"}
          </button>
        {/if}
        {@html item.row.unified}
        {#if item.row.anchor && path && onSave && openKey === keyOf(item.row.anchor)}
          {@const a = item.row.anchor}
          <CommentBox
            anchor={a}
            {path}
            body={bodyAt(a)}
            hasDraft={draft.length > 0}
            {busy}
            onSave={(b) => {
              onSave(a, b);
              openKey = null;
            }}
            onPostNow={(b) => {
              onPostNow?.(a, b);
              openKey = null;
            }}
            onCancel={() => (openKey = null)}
          />
        {/if}
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
            <div class="diff-side is-before" data-op="same">{@html row.before}</div>
            <div class="diff-side is-after" data-op="same">{@html row.after}</div>
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
        <div class="diff-side is-before" data-op={item.row.op === "added" ? "absent" : item.row.op}>
          {#if item.row.op === "added"}<span class="diff-absent">—</span>{:else}{@html item.row
              .before}{/if}
        </div>
        <div class="diff-side is-after" data-op={item.row.op === "removed" ? "absent" : item.row.op}>
          {#if item.row.op === "removed"}<span class="diff-absent">—</span>{:else}{@html item.row
              .after}{/if}
        </div>
      {/if}
    {/each}
  </div>
{/if}
