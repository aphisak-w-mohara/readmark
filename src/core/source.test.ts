import { test, expect, describe } from "bun:test";
import { resolveGitHub, fetchMarkdown, SourceError, type FetchLike } from "./source";

describe("resolveGitHub", () => {
  test("empty input is an error", () => {
    expect(resolveGitHub("  ").kind).toBe("error");
  });

  test("owner/repo shorthand -> readme API", () => {
    const r = resolveGitHub("facebook/react");
    expect(r).toMatchObject({
      kind: "api",
      url: "https://api.github.com/repos/facebook/react/readme",
    });
  });

  test("repo URL -> readme API", () => {
    const r = resolveGitHub("https://github.com/microsoft/vscode");
    expect(r).toMatchObject({
      kind: "api",
      url: "https://api.github.com/repos/microsoft/vscode/readme",
    });
  });

  test("tree URL carries the branch as ?ref", () => {
    const r = resolveGitHub("https://github.com/torvalds/linux/tree/v6.1");
    expect(r).toMatchObject({
      kind: "api",
      url: "https://api.github.com/repos/torvalds/linux/readme?ref=v6.1",
    });
  });

  test("blob URL -> raw URL", () => {
    const r = resolveGitHub("https://github.com/openai/openai-python/blob/main/README.md");
    expect(r).toMatchObject({
      kind: "raw",
      url: "https://raw.githubusercontent.com/openai/openai-python/main/README.md",
      name: "README.md",
    });
  });

  test("raw URL passes through", () => {
    const r = resolveGitHub("https://raw.githubusercontent.com/nodejs/node/main/README.md");
    expect(r).toMatchObject({
      kind: "raw",
      url: "https://raw.githubusercontent.com/nodejs/node/main/README.md",
    });
  });
});

const res = (ok: boolean, status: number, body = "") => ({ ok, status, text: async () => body });

describe("fetchMarkdown", () => {
  test("bad input throws SourceError(bad) without fetching", async () => {
    let called = false;
    const f: FetchLike = async () => {
      called = true;
      return res(true, 200);
    };
    await expect(fetchMarkdown("", f)).rejects.toBeInstanceOf(SourceError);
    expect(called).toBe(false);
  });

  test("api request sends the raw Accept header and returns text + name", async () => {
    let seenUrl = "";
    let seenAccept = "";
    const f: FetchLike = async (url, init) => {
      seenUrl = url;
      seenAccept = init?.headers?.Accept ?? "";
      return res(true, 200, "# Readme body");
    };
    const out = await fetchMarkdown("facebook/react", f);
    expect(seenUrl).toBe("https://api.github.com/repos/facebook/react/readme");
    expect(seenAccept).toBe("application/vnd.github.raw");
    expect(out).toEqual({ markdown: "# Readme body", name: "react · README" });
  });

  test("404 -> http error", async () => {
    const f: FetchLike = async () => res(false, 404);
    await expect(fetchMarkdown("a/b", f)).rejects.toMatchObject({ kind: "http" });
  });

  test("network throw -> net error", async () => {
    const f: FetchLike = async () => {
      throw new Error("offline");
    };
    await expect(fetchMarkdown("a/b", f)).rejects.toMatchObject({ kind: "net" });
  });
});
