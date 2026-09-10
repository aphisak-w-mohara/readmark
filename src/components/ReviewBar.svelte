<script lang="ts">
  import { canSubmit, type ReviewEvent } from "../core/review";

  interface Props {
    count: number;
    busy: boolean;
    error: string | null;
    submitted: string | null;
    onSubmit: (event: ReviewEvent, summary: string) => void;
    onDismiss: () => void;
  }
  let { count, busy, error, submitted, onSubmit, onDismiss }: Props = $props();

  let event = $state<ReviewEvent | null>(null);
  let summary = $state("");

  const ready = $derived(event ? canSubmit(event, summary) : false);

  // Approving needs no summary, so it sends straight away; the other two
  // open the field GitHub requires them to fill.
  function choose(e: ReviewEvent) {
    if (e === "APPROVE") onSubmit(e, "");
    else event = e;
  }

  function send() {
    if (!event || !ready) return;
    onSubmit(event, summary);
    event = null;
    summary = "";
  }
</script>

<div id="reviewbar">
  {#if submitted}
    <span class="rv-done">Review sent.</span>
    <a class="rv-link" href={submitted} target="_blank" rel="noopener">See it on GitHub</a>
    <span class="rv-spacer"></span>
    <button class="rv-btn" onclick={onDismiss}>Dismiss</button>
  {:else}
    <span class="rv-count">
      {count}
      pending comment{count === 1 ? "" : "s"}
    </span>

    {#if event}
      <input
        class="rv-summary"
        bind:value={summary}
        placeholder={event === "REQUEST_CHANGES"
          ? "What needs to change?"
          : "A line about this review"}
        onkeydown={(e) => e.key === "Enter" && send()}
      />
      <button class="rv-btn primary" onclick={send} disabled={!ready || busy}>
        {busy ? "Sending…" : event === "REQUEST_CHANGES" ? "Request changes" : "Comment"}
      </button>
      <button class="rv-btn" onclick={() => (event = null)}>Cancel</button>
    {:else}
      <span class="rv-spacer"></span>
      <button class="rv-btn" onclick={() => choose("COMMENT")} disabled={busy}>Comment</button>
      <button class="rv-btn" onclick={() => choose("REQUEST_CHANGES")} disabled={busy}>
        Request changes
      </button>
      <button class="rv-btn approve" onclick={() => choose("APPROVE")} disabled={busy}>
        {busy ? "Sending…" : "Approve"}
      </button>
    {/if}
  {/if}
</div>

{#if error}
  <div id="reviewerr" role="alert">
    {error}
    <button class="rv-link" onclick={onDismiss}>Dismiss</button>
  </div>
{/if}
