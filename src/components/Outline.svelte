<script lang="ts">
  import type { Heading } from "../core/markdown";
  interface Props {
    headings: Heading[];
    activeId: string | null;
    onJump: (id: string) => void;
  }
  let { headings, activeId, onJump }: Props = $props();
</script>

<aside id="outline">
  <div class="rail-head">Contents</div>
  <nav id="toc">
    {#if headings.length === 0}
      <div class="toc-empty">No headings yet.</div>
    {:else}
      {#each headings as h (h.id)}
        <button class="toc-item" data-lvl={h.level} class:active={h.id === activeId} onclick={() => onJump(h.id)}>
          {h.text}
        </button>
      {/each}
    {/if}
  </nav>
</aside>
