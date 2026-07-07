/**
 * Reactive application state (Svelte 5 runes).
 *
 * This is the thin glue tier: it owns reactive state and delegates all real
 * work to the pure core (prefs validation/persistence, markdown rendering,
 * highlighting). The core never imports Svelte.
 */
import DOMPurify from "dompurify";
import { loadPrefs, savePrefs, type Prefs, type StorageLike } from "./core/prefs";
import { toHtml, type Rendered } from "./core/markdown";
import { highlight } from "./core/highlight";

const memory: StorageLike = (() => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
})();

const storage: StorageLike = typeof localStorage !== "undefined" ? localStorage : memory;

class ReadmarkStore {
  prefs = $state<Prefs>(loadPrefs(storage));
  doc = $state<Rendered>({ html: "", headings: [], title: "Readmark" });
  outlineOpen = $state(true);
  zen = $state(false);

  constructor() {
    this.outlineOpen = this.prefs.outline;
  }

  /** Render Markdown, then sanitize the HTML (the parser passes raw HTML from
   *  untrusted sources through untouched — this is where it's made safe). */
  load(markdown: string) {
    const rendered = toHtml(markdown, { highlight });
    const html = DOMPurify.sanitize(rendered.html, { ADD_ATTR: ["target", "loading"] });
    this.doc = { ...rendered, html };
  }

  /** Update reading preferences and persist. */
  patchPrefs(patch: Partial<Prefs>) {
    this.prefs = { ...this.prefs, ...patch };
    savePrefs(storage, this.prefs);
  }

  toggleOutline() {
    this.outlineOpen = !this.outlineOpen;
    this.patchPrefs({ outline: this.outlineOpen });
  }

  toggleZen() {
    this.zen = !this.zen;
  }
}

export const store = new ReadmarkStore();
