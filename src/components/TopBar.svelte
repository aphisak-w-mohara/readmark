<script lang="ts">
  interface Props {
    title: string;
    outlineOpen: boolean;
    focus: boolean;
    onSource: () => void;
    onToggleOutline: () => void;
    onAa: () => void;
    onToggleFocus: () => void;
  }
  let { title, outlineOpen, focus, onSource, onToggleOutline, onAa, onToggleFocus }: Props = $props();
</script>

<header id="bar">
  <div class="brand"><span class="mark">A</span><span class="name">Codex</span></div>
  <div class="bar-center"><span id="docTitle">{title}</span></div>
  <div class="bar-tools">
    <button class="tool" onclick={onSource} title="Load Markdown or a GitHub URL">
      <svg viewBox="0 0 24 24"><path d="M4 5h16M4 12h16M4 19h10" /></svg><span>Source</span>
    </button>
    <div class="sep"></div>
    <button class="tool" class:on={outlineOpen} onclick={onToggleOutline} title="Toggle outline" aria-pressed={outlineOpen}>
      <svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>
    </button>
    <button class="tool" onclick={onAa} title="Reading settings"><span class="aa">A<span class="s">a</span></span></button>
    <button class="tool" class:on={focus} onclick={onToggleFocus} title="Focus mode" aria-pressed={focus}>
      <svg viewBox="0 0 24 24"
        ><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><circle
          cx="12"
          cy="12"
          r="2.5"
        /></svg
      >
    </button>
  </div>
</header>
