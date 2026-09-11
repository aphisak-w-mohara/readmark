/** HTML-escaping primitives. Pure, no DOM. */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const escapeAttr = (s: string): string => escapeHtml(s).replace(/"/g, "&quot;");

/** Neutralise `javascript:` URLs; leave everything else intact. */
export const safeUrl = (u: string): string => {
  u = (u || "").trim();
  return /^\s*javascript:/i.test(u) ? "#" : u;
};

/**
 * An opener the HTML parser reads to end-of-input when nothing closes it:
 * a comment, or a raw-text element whose body is never markup. Everything
 * after such a token becomes its body, so one dangling `<!--` — or prose
 * that merely mentions `<style>` — blanks the rest of the page.
 */
// ponytail: the lookahead rescans the tail per candidate — 0.06ms on a
// 190KB document, but 370ms on a synthetic one naming raw tags 4000
// times. A single-pass scan is the upgrade if that ever shows up.
const DANGLING =
  /<!--(?![\s\S]*?-->)|<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript|plaintext)\b(?![\s\S]*?<\/\1\s*>)/gi;

/** Show an opener nothing closes as the text it is, so it closes nothing. */
export const sealDangling = (html: string): string =>
  html.replace(DANGLING, (m) => `&lt;${m.slice(1)}`);
