<script lang="ts">
  import { fetchMarkdown, type SourceError } from "../core/source";

  interface Props {
    open: boolean;
    onClose: () => void;
    onRender: (markdown: string) => void;
  }
  let { open, onClose, onRender }: Props = $props();

  let tab = $state<"paste" | "github">("paste");
  let mdText = $state("");
  let ghUrl = $state("");
  let note = $state<{ kind: "err" | "info"; msg: string } | null>(null);
  let busy = $state(false);

  const examples = [
    { url: "https://github.com/microsoft/vscode", label: "microsoft/vscode" },
    { url: "https://github.com/facebook/react", label: "facebook/react" },
    { url: "https://github.com/tailwindlabs/tailwindcss", label: "tailwindlabs/tailwindcss" },
  ];

  async function go() {
    note = null;
    if (tab === "paste") {
      if (!mdText.trim()) return;
      onRender(mdText);
      onClose();
      return;
    }
    if (!ghUrl.trim()) {
      note = { kind: "err", msg: "Paste a GitHub URL first." };
      return;
    }
    busy = true;
    try {
      const { markdown } = await fetchMarkdown(ghUrl, (u, init) => fetch(u, init));
      onRender(markdown);
      onClose();
    } catch (e) {
      const err = e as SourceError;
      note = { kind: err.kind === "net" ? "info" : "err", msg: err.message };
    } finally {
      busy = false;
    }
  }

  function pasteKey(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go();
  }
  function ghKey(e: KeyboardEvent) {
    if (e.key === "Enter") go();
  }
</script>

<div class="panel" id="sourcePanel" class:show={open} role="dialog" aria-label="Load document">
  <div class="src-head">
    <div class="src-tabs">
      <button class="src-tab" class:sel={tab === "paste"} onclick={() => (tab = "paste")}>
        <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" /></svg>Paste Markdown
      </button>
      <button class="src-tab" class:sel={tab === "github"} onclick={() => (tab = "github")}>
        <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" /></svg>GitHub URL
      </button>
    </div>
    <button class="src-close" onclick={onClose} aria-label="Close">
      <svg viewBox="0 0 24 24" width="17" height="17" stroke="currentColor" fill="none" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>

  <div class="src-body">
    {#if tab === "paste"}
      <div class="src-pane show">
        <textarea id="mdInput" bind:value={mdText} onkeydown={pasteKey} placeholder="# Paste your Markdown here&#10;&#10;It renders the moment you press Render Document."></textarea>
      </div>
    {:else}
      <div class="src-pane show">
        <div class="gh-row">
          <input id="ghUrl" type="text" bind:value={ghUrl} onkeydown={ghKey} placeholder="https://github.com/owner/repo  ·  or a link to any .md file" />
        </div>
        <p class="gh-hint">
          Paste a repo, a <code>/blob/</code> file link, or a <code>raw.githubusercontent.com</code> URL. Codex resolves it and pulls the README when you point at a repo root.
        </p>
        <div class="gh-ex">
          {#each examples as ex (ex.url)}
            <button onclick={() => (ghUrl = ex.url)}>{ex.label}</button>
          {/each}
        </div>
        {#if note}
          <div class="note {note.kind}">{note.msg}</div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="src-foot">
    <button class="btn btn-ghost" onclick={onClose}>Cancel</button>
    <span class="spacer"></span>
    <button class="btn btn-primary" onclick={go} disabled={busy}>
      {#if busy}<span class="spin"></span>Fetching{:else}Render Document{/if}
    </button>
  </div>
</div>
