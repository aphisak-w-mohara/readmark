import { test, expect, describe } from "bun:test";
import { resolvePR, fetchPr, listMarkdownFiles, fetchSides, type PrInfo } from "./pr";
import { SourceError, type FetchLike } from "./source";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** A fake network: a path -> body map, plus a log of what was asked for. */
function fakeFetch(routes: Record<string, unknown>, status = 200) {
  const seen: string[] = [];
  const fn: FetchLike = async (url) => {
    seen.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (key === undefined)
      return { ok: false, status: 404, text: async () => '{"message":"Not Found"}' };
    return { ok: status < 400, status, text: async () => JSON.stringify(routes[key]) };
  };
  return { fn, seen };
}

const PR: PrInfo = {
  owner: "o",
  repo: "r",
  number: 42,
  title: "Rewrite the install guide",
  baseSha: "base1",
  headSha: "head1",
  url: "https://github.com/o/r/pull/42",
};

describe("resolvePR", () => {
  test("accepts the shapes GitHub hands you", () => {
    const want = { owner: "o", repo: "r", number: 42 };
    expect(resolvePR("https://github.com/o/r/pull/42")).toEqual(want);
    expect(resolvePR("https://github.com/o/r/pull/42/files")).toEqual(want);
    expect(resolvePR("https://github.com/o/r/pull/42/commits/abc123")).toEqual(want);
    expect(resolvePR("https://github.com/o/r/pull/42/")).toEqual(want);
    expect(resolvePR("github.com/o/r/pull/42")).toEqual(want);
    expect(resolvePR("  https://github.com/o/r/pull/42#discussion  ")).toEqual(want);
  });

  test("declines everything that is not a pull request URL", () => {
    expect(resolvePR("https://github.com/o/r")).toBeNull();
    expect(resolvePR("https://github.com/o/r/blob/main/README.md")).toBeNull();
    expect(resolvePR("https://github.example.com/o/r/pull/42")).toBeNull();
    expect(resolvePR("https://gitlab.com/o/r/pull/42")).toBeNull();
    expect(resolvePR("")).toBeNull();
  });
});

describe("fetchPr", () => {
  test("reads the title and both commits", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/pulls/42": {
        title: "T",
        html_url: "https://github.com/o/r/pull/42",
        base: { sha: "b" },
        head: { sha: "h" },
      },
    });
    expect(await fetchPr({ owner: "o", repo: "r", number: 42 }, fn)).toMatchObject({
      title: "T",
      baseSha: "b",
      headSha: "h",
    });
  });

  test("a 404 explains that credentials may not cover the repo", async () => {
    const { fn } = fakeFetch({});
    expect(fetchPr({ owner: "o", repo: "r", number: 1 }, fn)).rejects.toThrow(/access/);
  });

  test("a network failure is a typed error, not a raw throw", async () => {
    const fn: FetchLike = async () => {
      throw new Error("offline");
    };
    expect(fetchPr({ owner: "o", repo: "r", number: 1 }, fn)).rejects.toBeInstanceOf(SourceError);
  });
});

describe("listMarkdownFiles", () => {
  test("keeps markdown, counts the rest", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/pulls/42/files": [
        { filename: "README.md", status: "modified", additions: 3, deletions: 1 },
        { filename: "docs/guide.mdx", status: "added", additions: 9, deletions: 0 },
        { filename: "src/index.ts", status: "modified", additions: 4, deletions: 4 },
        { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
      ],
    });
    const out = await listMarkdownFiles({ owner: "o", repo: "r", number: 42 }, fn);
    expect(out.markdown.map((f) => f.filename)).toEqual(["README.md", "docs/guide.mdx"]);
    expect(out.otherCount).toBe(2);
  });

  test("a rename carries its old path for the before side", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/pulls/42/files": [
        {
          filename: "docs/new.md",
          previous_filename: "docs/old.md",
          status: "renamed",
          additions: 1,
          deletions: 1,
        },
      ],
    });
    const out = await listMarkdownFiles({ owner: "o", repo: "r", number: 42 }, fn);
    expect(out.markdown[0].previousFilename).toBe("docs/old.md");
  });

  test("follows pagination until a short page", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      filename: `d/${i}.md`,
      status: "modified",
      additions: 1,
      deletions: 0,
    }));
    let call = 0;
    const fn: FetchLike = async () => {
      call++;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            call === 1
              ? page1
              : [{ filename: "last.md", status: "modified", additions: 1, deletions: 0 }],
          ),
      };
    };
    const out = await listMarkdownFiles({ owner: "o", repo: "r", number: 42 }, fn);
    expect(call).toBe(2);
    expect(out.markdown).toHaveLength(101);
  });
});

describe("fetchSides", () => {
  const file = {
    filename: "README.md",
    previousFilename: "README.md",
    status: "modified" as const,
    additions: 1,
    deletions: 1,
  };

  test("decodes both sides and asks for the right commits", async () => {
    const { fn, seen } = fakeFetch({
      "/repos/o/r/contents/README.md?ref=base1": { content: b64("old text"), encoding: "base64" },
      "/repos/o/r/contents/README.md?ref=head1": { content: b64("new text"), encoding: "base64" },
    });
    expect(await fetchSides(PR, file, fn)).toEqual({ before: "old text", after: "new text" });
    expect(seen.some((u) => u.includes("ref=base1"))).toBe(true);
    expect(seen.some((u) => u.includes("ref=head1"))).toBe(true);
  });

  test("decodes multi-byte content correctly", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/contents/README.md": { content: b64("héllo — wörld 🎉"), encoding: "base64" },
    });
    const out = await fetchSides(PR, file, fn);
    expect(out.after).toBe("héllo — wörld 🎉");
  });

  test("an added file has an empty before side and is never fetched at base", async () => {
    const { fn, seen } = fakeFetch({
      "/repos/o/r/contents/new.md?ref=head1": { content: b64("fresh"), encoding: "base64" },
    });
    const out = await fetchSides(
      PR,
      { ...file, filename: "new.md", previousFilename: "new.md", status: "added" },
      fn,
    );
    expect(out).toEqual({ before: "", after: "fresh" });
    expect(seen.some((u) => u.includes("base1"))).toBe(false);
  });

  test("a deleted file keeps its before side and has no after", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/contents/gone.md?ref=base1": { content: b64("was here"), encoding: "base64" },
    });
    const out = await fetchSides(
      PR,
      { ...file, filename: "gone.md", previousFilename: "gone.md", status: "removed" },
      fn,
    );
    expect(out).toEqual({ before: "was here", after: "" });
  });

  test("a file missing on one side reads as empty rather than failing", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/contents/README.md?ref=head1": { content: b64("only after"), encoding: "base64" },
    });
    expect(await fetchSides(PR, file, fn)).toEqual({ before: "", after: "only after" });
  });

  test("an oversized blob is refused with a readable reason", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/contents/README.md": { size: 2_000_000, content: "", encoding: "base64" },
    });
    expect(fetchSides(PR, file, fn)).rejects.toThrow(/too large/);
  });
});
