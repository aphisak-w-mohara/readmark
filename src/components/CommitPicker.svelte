<script lang="ts">
  import type { CommitRange, PrCommit } from "../core/pr";

  interface Props {
    open: boolean;
    commits: PrCommit[];
    range: CommitRange | null;
    /** The commit this user last reviewed at, if any. */
    lastReviewSha: string | null;
    onClose: () => void;
    onApply: (range: CommitRange | null) => void;
  }
  let { open, commits, range, lastReviewSha, onClose, onApply }: Props = $props();

  // Draft selection as a pair of indices, so the range is contiguous by
  // construction — there is no way to express a gap.
  let from = $state<number | null>(null);
  let to = $state<number | null>(null);

  const indexOf = (sha: string | null) => (sha ? commits.findIndex((c) => c.sha === sha) : -1);

  // Re-seed the draft each time the dialog opens, discarding an abandoned one.
  $effect(() => {
    if (!open) return;
    const f = indexOf(range?.fromSha ?? null);
    const t = indexOf(range?.toSha ?? null);
    from = f >= 0 ? f : null;
    to = t >= 0 ? t : null;
  });

  const selected = (i: number) => from !== null && to !== null && i >= from && i <= to;
  const count = $derived(from !== null && to !== null ? to - from + 1 : 0);

  /**
   * GitHub's interaction, without its ambiguity: the first click starts a
   * range, a click outside it extends the nearer end, and a click inside
   * pulls the nearer end in. Clicking the only selected commit clears it.
   */
  function toggle(i: number) {
    if (from === null || to === null) {
      from = i;
      to = i;
      return;
    }
    if (from === to && i === from) {
      from = null;
      to = null;
      return;
    }
    if (i < from) from = i;
    else if (i > to) to = i;
    else if (i - from <= to - i) from = i;
    else to = i;
  }

  /** The review row is only offered when that commit is still in the list. */
  const reviewIndex = $derived(indexOf(lastReviewSha));
  const canReview = $derived(reviewIndex >= 0 && reviewIndex < commits.length - 1);

  function sinceReview() {
    from = reviewIndex + 1;
    to = commits.length - 1;
  }

  function apply() {
    onApply(
      from !== null && to !== null
        ? { fromSha: commits[from].sha, toSha: commits[to].sha }
        : null,
    );
    onClose();
  }

  const day = (iso: string) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
</script>

<div class="panel" id="commitPanel" class:show={open} role="dialog" aria-label="Select commits to view">
  <div class="cm-head">
    <span>Select commits to view</span>
    <button class="src-close" onclick={onClose} aria-label="Close">
      <svg viewBox="0 0 24 24" width="17" height="17" stroke="currentColor" fill="none" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>

  <div class="cm-top">
    <button class="cm-opt" class:sel={count === 0} onclick={() => { from = null; to = null; }}>
      <span class="cm-tick" aria-hidden="true">{count === 0 ? "✓" : ""}</span>
      <span>
        <span class="cm-msg">All commits</span>
        <span class="cm-meta">{commits.length} commit{commits.length === 1 ? "" : "s"}</span>
      </span>
    </button>

    <button class="cm-opt" class:disabled={!canReview} onclick={sinceReview} disabled={!canReview}>
      <span class="cm-tick" aria-hidden="true"></span>
      <span>
        <span class="cm-msg">Changes since your last review</span>
        <span class="cm-meta">
          {#if reviewIndex < 0}
            No previous review found
          {:else if !canReview}
            Nothing new since your review
          {:else}
            {commits.length - 1 - reviewIndex} newer commit{commits.length - 1 - reviewIndex === 1
              ? ""
              : "s"}
          {/if}
        </span>
      </span>
    </button>
  </div>

  <div class="cm-divide">Select a range of commits</div>

  <div class="cm-list">
    {#each commits as c, i (c.sha)}
      <button
        class="cm-row"
        class:sel={selected(i)}
        class:edge={selected(i) && (i === from || i === to)}
        onclick={() => toggle(i)}
        aria-pressed={selected(i)}
      >
        <span class="cm-box" class:on={selected(i)} aria-hidden="true"></span>
        <span class="cm-body">
          <span class="cm-msg">{c.subject}</span>
          <span class="cm-meta">{c.author} committed on {day(c.date)}</span>
        </span>
        <code class="cm-sha">{c.sha.slice(0, 7)}</code>
      </button>
    {/each}
  </div>

  <div class="cm-foot">
    <span class="cm-count">
      {#if count}{count} of {commits.length} commits{:else}All {commits.length} commits{/if}
    </span>
    <button class="btn btn-ghost" onclick={onClose}>Cancel</button>
    <button class="btn btn-primary" onclick={apply}>View</button>
  </div>
</div>
