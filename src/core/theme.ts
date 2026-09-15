/**
 * Reading-experience option tables: the vocabulary every reading pref is drawn from.
 * Lives beside prefs.ts because that is what validates a stored pref against them.
 */

export interface FontOption {
  id: string;
  label: string;
  tag: "Serif" | "Sans";
  css: string;
}

export const FONTS: FontOption[] = [
  {
    id: "newyork",
    label: "New York",
    tag: "Serif",
    css: '"New York","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif',
  },
  {
    id: "charter",
    label: "Charter",
    tag: "Serif",
    css: '"Charter","Bitstream Charter","Sitka Text",Cambria,Georgia,serif',
  },
  { id: "georgia", label: "Georgia", tag: "Serif", css: 'Georgia,"Times New Roman",Times,serif' },
  {
    id: "palatino",
    label: "Palatino",
    tag: "Serif",
    css: '"Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif',
  },
  {
    id: "avenir",
    label: "Avenir",
    tag: "Sans",
    css: '"Avenir Next","Seravek","Segoe UI",-apple-system,system-ui,sans-serif',
  },
  {
    id: "system",
    label: "System",
    tag: "Sans",
    css: '-apple-system,"SF Pro Text","Segoe UI",system-ui,sans-serif',
  },
];

export const fontCss = (id: string): string => (FONTS.find((f) => f.id === id) ?? FONTS[0]).css;

/** An option a pref can hold: the stored value, and what the panel calls it. */
export interface Option {
  id: string;
  label: string;
}
export const THEMES: Option[] = [
  { id: "original", label: "Original" },
  { id: "quiet", label: "Quiet" },
  { id: "sepia", label: "Sepia" },
  { id: "night", label: "Night" },
  { id: "black", label: "Black" },
];

export const SPACING: Option[] = [
  { id: "1.42", label: "Tight" },
  { id: "1.66", label: "Normal" },
  { id: "1.95", label: "Airy" },
];

export const WIDTHS: Option[] = [
  { id: "56ch", label: "Narrow" },
  { id: "66ch", label: "Medium" },
  { id: "104ch", label: "Ultra" },
];

export const SIZE_MIN = 14;
export const SIZE_MAX = 30;
