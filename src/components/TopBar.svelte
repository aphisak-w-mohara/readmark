<script lang="ts">
  interface Props {
    title: string;
    outlineOpen: boolean;
    zen: boolean;
    onSource: () => void;
    onToggleOutline: () => void;
    onAa: () => void;
    onToggleZen: () => void;
  }
  let { title, outlineOpen, zen, onSource, onToggleOutline, onAa, onToggleZen }: Props = $props();
</script>

<header id="bar">
  <div class="brand"><span class="mark">R</span><span class="name">Readmark</span></div>
  <div class="bar-center"><span id="docTitle">{title}</span></div>
  <div class="bar-tools">
    <button class="tool" onclick={onSource} title="Open Markdown — paste or a GitHub URL">
      <svg viewBox="0 0 24 24"><path d="M4 5h16M4 12h16M4 19h10" /></svg><span>Open</span>
    </button>
    <div class="sep"></div>
    <button class="tool" class:on={outlineOpen} onclick={onToggleOutline} title="Toggle outline" aria-pressed={outlineOpen}>
      <svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg>
    </button>
    <button class="tool" onclick={onAa} title="Reading settings"><span class="aa">A<span class="s">a</span></span></button>
    <button class="tool" class:on={zen} onclick={onToggleZen} title="Zen mode — declutter for pure reading" aria-pressed={zen}>
      <svg viewBox="0 0 24 24"
        ><path d="M12 6.6C10.3 5.3 7.2 4.8 4.6 5.5a1 1 0 0 0-.6.9v11a1 1 0 0 0 1.2 1c2.3-.6 5-.1 6.8 1.1 1.8-1.2 4.5-1.7 6.8-1.1a1 1 0 0 0 1.2-1v-11a1 1 0 0 0-.6-.9C16.8 4.8 13.7 5.3 12 6.6Z" /><path
          d="M12 6.6v12"
        /></svg
      >
    </button>
  </div>
</header>
