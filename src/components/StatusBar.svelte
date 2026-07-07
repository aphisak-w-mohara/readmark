<script lang="ts">
  interface Props {
    title: string;
    words: number;
    minutes: number;
    pct: number;
  }
  let { title, words, minutes, pct }: Props = $props();
</script>

<footer id="status">
  <span class="st"><span class="dot"></span><span>{title}</span></span>
  <span class="spacer"></span>
  <span class="st"><b>{words.toLocaleString()}</b> words</span>
  <span class="st"><b>{minutes}</b> min read</span>
  <span class="st"><b>{pct}</b>%</span>
</footer>
