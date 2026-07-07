/** HTML-escaping primitives. Pure, no DOM. */
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const escapeAttr = (s: string): string => escapeHtml(s).replace(/"/g, "&quot;");

/** Neutralise `javascript:` URLs; leave everything else intact. */
export const safeUrl = (u: string): string => {
  u = (u || "").trim();
  return /^\s*javascript:/i.test(u) ? "#" : u;
};
