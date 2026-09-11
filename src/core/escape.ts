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
 * Elements the HTML tokenizer reads as text, not markup, until their end
 * tag. Their bodies are never Markdown and never HTML, and an unclosed
 * one runs to the end of the input.
 */
export const RAW_TEXT =
  "script style textarea title iframe xmp noembed noframes noscript plaintext".split(" ");

/**
 * An opener the parser reads to end-of-input when nothing closes it.
 * Everything after such a token becomes its body, so one dangling `<!--`
 * blanks the rest of the page.
 *
 * The closer must be a real end tag: `</style x>` and `</style/>` are,
 * `</stylesheet>` is not, and accepting that one would excuse the opener
 * it is not closing. <plaintext> takes no lookahead at all — it has no
 * end tag in the tokenizer, so nothing can excuse it.
 */
// ponytail: the lookahead asks "is there a closer anywhere later", not
// "is THIS one closed" — so a real <style> further down the document
// excuses an unclosed one above it. Inline mentions, the common case,
// are escaped upstream in markdown.ts; a block-level pair like that
// needs a tokenizer to tell apart, which is the upgrade if it shows up.
const DANGLING = new RegExp(
  `<!--(?![\\s\\S]*?-->)|<plaintext\\b|<(${RAW_TEXT.join("|")})\\b(?![\\s\\S]*?</\\1(?=[\\s/>])[^>]*>)`,
  "gi",
);

/** Show an opener nothing closes as the text it is, so it closes nothing. */
export const sealDangling = (html: string): string =>
  html.replace(DANGLING, (m) => `&lt;${m.slice(1)}`);
