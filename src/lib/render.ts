/**
 * Markdown to safe HTML — the one place that decides what "safe" means.
 *
 * The parser deliberately passes raw HTML through, so sanitising is the
 * view tier's job. Keeping it in a single function means a future
 * tightening of the policy reaches documents and comment previews alike,
 * rather than only whichever one the author remembered.
 */
import DOMPurify from "dompurify";
import { toHtml, type Rendered } from "../core/markdown";
import { highlight } from "../core/highlight";

const ADD_ATTR = ["target", "loading"];

/** Sanitize already-rendered HTML. */
export const clean = (html: string): string => DOMPurify.sanitize(html, { ADD_ATTR });

/** Render a document: sanitized HTML, plus the outline and title. */
export function render(src: string): Rendered {
  const r = toHtml(src, { highlight });
  return { ...r, html: clean(r.html) };
}

/** Render a fragment — a comment body — to sanitized HTML. */
export const renderMd = (src: string): string => render(src).html;
