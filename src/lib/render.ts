/**
 * Markdown to safe HTML — the one place that decides what "safe" means.
 *
 * The parser deliberately passes raw HTML through, so sanitising is the
 * view tier's job. Keeping it in a single function means a future
 * tightening of the policy reaches documents and comment previews alike,
 * rather than only whichever one the author remembered.
 */
import DOMPurify from "dompurify";
import { toHtml } from "../core/markdown";
import { highlight } from "../core/highlight";

const ADD_ATTR = ["target", "loading"];

/** Sanitize already-rendered HTML. */
export const clean = (html: string): string => DOMPurify.sanitize(html, { ADD_ATTR });

/** Render Markdown and sanitize it in one step. */
export function renderMd(src: string): string {
  return clean(toHtml(src, { highlight }).html);
}
