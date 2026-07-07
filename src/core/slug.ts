/** Turn heading text into a URL-safe id. */
export function slugify(t: string): string {
  return (
    t
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-") || "section"
  );
}

/** A slugger that de-duplicates repeated ids within one document. */
export function makeSlugger(): (t: string) => string {
  const used: Record<string, number> = {};
  return (t: string) => {
    let id = slugify(t);
    if (used[id] != null) {
      used[id] += 1;
      id += "-" + used[id];
    } else {
      used[id] = 0;
    }
    return id;
  };
}
