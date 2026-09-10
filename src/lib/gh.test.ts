import { test, expect, describe } from "bun:test";
import { makeGhFetch, probeSession } from "./gh";

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function recorder(status = 200) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok: status < 400, status, text: async () => "{}" } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetchFn };
}

const TOKEN = "github_pat_" + "A".repeat(30);

describe("makeGhFetch", () => {
  test("a session request goes to the same-origin proxy with no Authorization", async () => {
    const { calls, fetchFn } = recorder();
    await makeGhFetch({ mode: "session" }, { fetchFn })("/repos/o/r/pulls/1");
    expect(calls[0].url).toBe("/api/gh/repos/o/r/pulls/1");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(calls[0].init?.credentials).toBe("same-origin");
  });

  test("a token request goes to api.github.com with a Bearer header", async () => {
    const { calls, fetchFn } = recorder();
    await makeGhFetch({ mode: "token", token: TOKEN }, { fetchFn })("/repos/o/r/pulls/1");
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r/pulls/1");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("the token never appears in the URL", async () => {
    const { calls, fetchFn } = recorder();
    const gh = makeGhFetch({ mode: "token", token: TOKEN }, { fetchFn });
    await gh("/repos/o/r/pulls/1/files?per_page=100&page=1");
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].url).not.toContain("github_pat_");
  });

  test("a token request does not send cookies", async () => {
    const { calls, fetchFn } = recorder();
    await makeGhFetch({ mode: "token", token: TOKEN }, { fetchFn })("/user");
    expect(calls[0].init?.credentials).toBeUndefined();
  });

  test("both modes send the API version header", async () => {
    const { calls, fetchFn } = recorder();
    await makeGhFetch({ mode: "session" }, { fetchFn })("/user");
    await makeGhFetch({ mode: "token", token: TOKEN }, { fetchFn })("/user");
    for (const c of calls) {
      const headers = c.init?.headers as Record<string, string>;
      expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    }
  });
});

describe("probeSession", () => {
  test("a 200 means the backend is there and we are signed in", async () => {
    const { fetchFn } = recorder(200);
    expect(await probeSession({ fetchFn })).toEqual({ available: true, signedIn: true });
  });

  test("a 401 still means the backend is there", async () => {
    const { fetchFn } = recorder(401);
    expect(await probeSession({ fetchFn })).toEqual({ available: true, signedIn: false });
  });

  test("a 404 means this is a static build with no Functions", async () => {
    const { fetchFn } = recorder(404);
    expect(await probeSession({ fetchFn })).toEqual({ available: false, signedIn: false });
  });

  test("an unreachable origin is not available", async () => {
    const fetchFn = (async () => {
      throw new Error("file:// has no origin");
    }) as unknown as typeof globalThis.fetch;
    expect(await probeSession({ fetchFn })).toEqual({ available: false, signedIn: false });
  });
});
