<script lang="ts">
  import { store } from "../state.svelte";
  import { THEMES, FONTS, SPACING, WIDTHS, SIZE_MIN, SIZE_MAX } from "../lib/theme";

  interface Props {
    open: boolean;
  }
  let { open }: Props = $props();

  const p = $derived(store.prefs);
  function step(d: number) {
    store.patchPrefs({ size: Math.min(SIZE_MAX, Math.max(SIZE_MIN, p.size + d)) });
  }
</script>

<div class="panel" id="aaPanel" class:show={open} role="dialog" aria-label="Reading settings">
  <div class="aa-sec">
    <div class="aa-label">Theme</div>
    <div class="themes">
      {#each THEMES as t (t.id)}
        <button class="swatch" class:sel={p.theme === t.id} data-t={t.id} title={t.label} aria-label={t.label} onclick={() => store.patchPrefs({ theme: t.id })}>A</button>
      {/each}
    </div>
  </div>

  <div class="aa-sec">
    <div class="aa-label">Typeface</div>
    <div class="fonts">
      {#each FONTS as f (f.id)}
        <button class="font-opt" class:sel={p.font === f.id} style="font-family:{f.css}" onclick={() => store.patchPrefs({ font: f.id })}>
          <span class="fname">{f.label}</span><span class="ftag">{f.tag}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="aa-sec">
    <div class="aa-label">Text size</div>
    <div class="stepper">
      <button class="a1" aria-label="Smaller text" onclick={() => step(-1)}>A</button>
      <span class="val">{p.size} px</span>
      <button class="a2" aria-label="Larger text" onclick={() => step(1)}>A</button>
    </div>
  </div>

  <div class="aa-sec">
    <div class="aa-label">Line spacing</div>
    <div class="seg">
      {#each SPACING as s (s.v)}
        <button class:sel={p.spacing === s.v} onclick={() => store.patchPrefs({ spacing: s.v })}>{s.label}</button>
      {/each}
    </div>
  </div>

  <div class="aa-sec">
    <div class="aa-label">Page width</div>
    <div class="seg">
      {#each WIDTHS as w (w.v)}
        <button class:sel={p.width === w.v} onclick={() => store.patchPrefs({ width: w.v })}>{w.label}</button>
      {/each}
    </div>
  </div>
</div>
