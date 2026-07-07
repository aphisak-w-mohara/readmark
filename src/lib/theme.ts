/** Reading-experience option tables shared by the Aa panel and the state layer. */

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

export interface ThemeOption {
  id: string;
  label: string;
}
export const THEMES: ThemeOption[] = [
  { id: "original", label: "Original" },
  { id: "quiet", label: "Quiet" },
  { id: "sepia", label: "Sepia" },
  { id: "night", label: "Night" },
  { id: "black", label: "Black" },
];

export const SPACING = [
  { v: "1.42", label: "Tight" },
  { v: "1.66", label: "Normal" },
  { v: "1.95", label: "Airy" },
];

export const WIDTHS = [
  { v: "56ch", label: "Narrow" },
  { v: "66ch", label: "Medium" },
  { v: "82ch", label: "Wide" },
];

export const SIZE_MIN = 14;
export const SIZE_MAX = 30;
