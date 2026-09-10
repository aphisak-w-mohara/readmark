<script lang="ts">
  import { untrack } from "svelte";
  import { toHtml } from "../core/markdown";
  import { highlight } from "../core/highlight";
  import DOMPurify from "dompurify";
  import type { Anchor } from "../core/review";

  interface Props {
    anchor: Anchor;
    path: string;
    /** Existing draft body, when editing rather than starting. */
    body: string;
    /** Whether a review is already open, which changes the primary action. */
    hasDraft: boolean;
    busy: boolean;
    onSave: (body: string) => void;
    onPostNow: (body: string) => void;
    onCancel: () => void;
  }
  let { anchor, path, body, hasDraft, busy, onSave, onPostNow, onCancel }: Props = $props();

  // Seeded once: the box is created fresh for each anchor, so an existing
  // draft is a starting value, not something to track.
  let text = $state(untrack(() => body));
  let tab = $state<"write" | "preview">("write");
  let area = $state<HTMLTextAreaElement>();

  $effect(() => {
    area?.focus();
  });

  /** The anchor as GitHub names it: R for the new side, L for the old. */
  const label = $derived(
    `${anchor.side === "RIGHT" ? "R" : "L"}${anchor.startLine ? `${anchor.startLine}–${anchor.line}` : anchor.line}`,
  );

  // Previewed through the app's own pipeline, so a comment looks the way
  // the document does rather than the way a form does.
  const preview = $derived(
    text.trim()
      ? DOMPurify.sanitize(toHtml(text, { highlight }).html, { ADD_ATTR: ["target", "loading"] })
      : "",
  );

  function key(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) {
      onSave(text);
    }
  }
</script>

<div class="cbox" role="group" aria-label="Write a review comment">
  <div class="cbox-head">
    <span>Comment on <code class="cbox-anchor">{label}</code></span>
    <span class="cbox-path">{path.split("/").pop()}</span>
  </div>

  <div class="cbox-tabs">
    <button class:on={tab === "write"} onclick={() => (tab = "write")}>Write</button>
    <button class:on={tab === "preview"} onclick={() => (tab = "preview")} disabled={!text.trim()}>
      Preview
    </button>
  </div>

  <div class="cbox-body">
    {#if tab === "write"}
      <textarea
        bind:this={area}
        bind:value={text}
        onkeydown={key}
        placeholder="Leave a comment"
        aria-label="Comment body"
      ></textarea>
    {:else}
      <div class="cbox-preview md">{@html preview}</div>
    {/if}
  </div>

  <div class="cbox-foot">
    <span class="cbox-hint">Markdown supported</span>
    <button class="btn btn-ghost" onclick={onCancel}>Cancel</button>
    <button class="btn" onclick={() => onPostNow(text)} disabled={!text.trim() || busy}>
      Comment
    </button>
    <button class="btn btn-primary" onclick={() => onSave(text)} disabled={!text.trim() || busy}>
      {hasDraft ? "Add to review" : "Start a review"}
    </button>
  </div>
</div>
