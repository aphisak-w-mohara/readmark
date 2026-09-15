import { test, expect, describe } from "bun:test";
import {
  resolvePR,
  fetchPr,
  fetchViewer,
  listMarkdownFiles,
  listMarkdownFilesBetween,
  listCommits,
  resolveRange,
  currentLogin,
  lastReviewedCommit,
  fetchSides,
  submitReview,
  postComment,
  type PrInfo,
} from "./pr";
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
  author: "octocat",
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

describe("fetchViewer", () => {
  test("reads the login the credential belongs to", async () => {
    const { fn } = fakeFetch({ "/user": { login: "octocat" } });
    expect(await fetchViewer(fn)).toBe("octocat");
  });

  // Used only to take a button away, so not knowing must leave it there.
  test("a failure is null, not a throw", async () => {
    const { fn } = fakeFetch({});
    expect(await fetchViewer(fn)).toBeNull();
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
        user: { login: "octocat" },
      },
    });
    expect(await fetchPr({ owner: "o", repo: "r", number: 42 }, fn)).toMatchObject({
      title: "T",
      baseSha: "b",
      headSha: "h",
      author: "octocat",
    });
  });

  // A PR whose author has since been deleted has a null user. No author
  // means no match, which offers the verdict rather than hiding it.
  test("a missing author is empty, not a crash", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/pulls/42": {
        title: "T",
        html_url: "u",
        base: { sha: "b" },
        head: { sha: "h" },
        user: null,
      },
    });
    expect((await fetchPr({ owner: "o", repo: "r", number: 42 }, fn)).author).toBe("");
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

describe("commits and ranges", () => {
  const commits = [
    { sha: "c1", parent: "base0", subject: "first", author: "a", date: "" },
    { sha: "c2", parent: "c1", subject: "second", author: "a", date: "" },
    { sha: "c3", parent: "c2", subject: "third", author: "a", date: "" },
  ];

  test("listCommits keeps order, subject line and first parent", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/pulls/42/commits": [
        {
          sha: "aaa",
          parents: [{ sha: "p1" }, { sha: "p2" }],
          commit: {
            message: "feat: add thing\n\nlong body here",
            author: { name: "N", date: "d" },
          },
          author: { login: "octo" },
        },
      ],
    });
    const out = await listCommits({ owner: "o", repo: "r", number: 42 }, fn);
    expect(out).toEqual([
      { sha: "aaa", parent: "p1", subject: "feat: add thing", author: "octo", date: "d" },
    ]);
  });

  test("listCommits falls back to the commit author when there is no account", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/pulls/42/commits": [
        {
          sha: "a",
          parents: [],
          commit: { message: "x", author: { name: "Ada", date: "d" } },
          author: null,
        },
      ],
    });
    const out = await listCommits({ owner: "o", repo: "r", number: 42 }, fn);
    expect(out[0]).toMatchObject({ author: "Ada", parent: "" });
  });

  test("no range diffs the pull request itself", () => {
    expect(resolveRange(PR, commits, null)).toEqual({ base: "base1", head: "head1" });
  });

  test("a range starts at the parent of its first commit", () => {
    expect(resolveRange(PR, commits, { fromSha: "c2", toSha: "c3" })).toEqual({
      base: "c1",
      head: "c3",
    });
  });

  test("a single commit is its parent against itself", () => {
    expect(resolveRange(PR, commits, { fromSha: "c2", toSha: "c2" })).toEqual({
      base: "c1",
      head: "c2",
    });
  });

  test("the whole range still starts from the PR base, not a missing parent", () => {
    const orphan = [{ sha: "c1", parent: "", subject: "s", author: "a", date: "" }];
    expect(resolveRange(PR, orphan, { fromSha: "c1", toSha: "c1" })).toEqual({
      base: "base1",
      head: "c1",
    });
  });

  test("an unknown sha falls back to the whole pull request", () => {
    expect(resolveRange(PR, commits, { fromSha: "nope", toSha: "c3" })).toEqual({
      base: "base1",
      head: "head1",
    });
  });

  test("listMarkdownFilesBetween filters a compare the same way", async () => {
    const { fn, seen } = fakeFetch({
      "/repos/o/r/compare/c1...c3": {
        files: [
          { filename: "a.md", status: "modified", additions: 1, deletions: 1 },
          { filename: "b.ts", status: "modified", additions: 1, deletions: 1 },
        ],
      },
    });
    const out = await listMarkdownFilesBetween(
      { owner: "o", repo: "r", number: 42 },
      "c1",
      "c3",
      fn,
    );
    expect(out.markdown.map((f) => f.filename)).toEqual(["a.md"]);
    expect(out.otherCount).toBe(1);
    expect(seen[0]).toContain("/compare/c1...c3");
  });

  test("a compare with no files listed is empty, not a crash", async () => {
    const { fn } = fakeFetch({ "/repos/o/r/compare/x...y": { status: "identical" } });
    const out = await listMarkdownFilesBetween({ owner: "o", repo: "r", number: 42 }, "x", "y", fn);
    expect(out).toEqual({ markdown: [], otherCount: 0 });
  });
});

describe("last review", () => {
  const ref = { owner: "o", repo: "r", number: 42 };

  test("finds this user's most recent submitted review", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/pulls/42/reviews": [
        { user: { login: "me" }, state: "COMMENTED", commit_id: "old", submitted_at: "1" },
        { user: { login: "other" }, state: "APPROVED", commit_id: "theirs", submitted_at: "2" },
        { user: { login: "me" }, state: "CHANGES_REQUESTED", commit_id: "mine", submitted_at: "3" },
      ],
    });
    expect(await lastReviewedCommit(ref, "me", fn)).toBe("mine");
  });

  test("ignores pending reviews, which have no commit yet", async () => {
    const { fn } = fakeFetch({
      "/repos/o/r/pulls/42/reviews": [
        { user: { login: "me" }, state: "APPROVED", commit_id: "done", submitted_at: "1" },
        { user: { login: "me" }, state: "PENDING", commit_id: null, submitted_at: null },
      ],
    });
    expect(await lastReviewedCommit(ref, "me", fn)).toBe("done");
  });

  test("never reviewed is null, not an error", async () => {
    const { fn } = fakeFetch({ "/repos/o/r/pulls/42/reviews": [] });
    expect(await lastReviewedCommit(ref, "me", fn)).toBeNull();
  });

  test("currentLogin swallows a failure rather than blocking the diff", async () => {
    const { fn } = fakeFetch({});
    expect(await currentLogin(fn)).toBeNull();
  });
});

describe("writing a review", () => {
  const ref = { owner: "o", repo: "r", number: 42 };
  const draft = [{ path: "a.md", side: "RIGHT" as const, line: 3, body: "a note" }];

  /** Records what was sent, so the request body itself is the assertion. */
  function recorder(status = 200, body = '{"id":1,"html_url":"u"}') {
    const sent: { url: string; method?: string; body?: unknown }[] = [];
    const fn: FetchLike = async (url, init) => {
      sent.push({
        url,
        method: init?.method,
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      return { ok: status < 400, status, text: async () => body };
    };
    return { fn, sent };
  }

  test("a review parks the draft, then passes the verdict", async () => {
    const { fn, sent } = recorder();
    await submitReview(ref, "headsha", "APPROVE", "", draft, fn);

    expect(sent[0].url).toBe("/repos/o/r/pulls/42/reviews");
    expect(sent[0].method).toBe("POST");
    expect(sent[0].body).toEqual({
      commit_id: "headsha",
      comments: [{ path: "a.md", line: 3, side: "RIGHT", body: "a note" }],
    });

    expect(sent[1].url).toBe("/repos/o/r/pulls/42/reviews/1/events");
    expect(sent[1].body).toEqual({ event: "APPROVE" });
  });

  /**
   * The point of the two calls: a one-shot COMMENT review is refused
   * without a summary, so sending the comments first is what lets the
   * field stay empty.
   */
  test("commenting with no summary sends no body", async () => {
    const { fn, sent } = recorder();
    await submitReview(ref, "h", "COMMENT", "   ", draft, fn);
    expect(sent[1].body).toEqual({ event: "COMMENT" });
  });

  test("a summary rides on the verdict, not on the comments", async () => {
    const { fn, sent } = recorder();
    await submitReview(ref, "h", "REQUEST_CHANGES", "please fix", draft, fn);
    expect(sent[0].body).not.toHaveProperty("body");
    expect(sent[1].body).toEqual({ event: "REQUEST_CHANGES", body: "please fix" });
  });

  /**
   * A pending review is invisible on the pull request but real. Left
   * behind by a failed verdict, the next attempt would park a second
   * copy of every comment on top of it.
   */
  test("a verdict that fails takes its pending review with it", async () => {
    const sent: { url: string; method?: string }[] = [];
    const fn: FetchLike = async (url, init) => {
      sent.push({ url, method: init?.method });
      const failing = url.endsWith("/events");
      return {
        ok: !failing,
        status: failing ? 422 : 200,
        text: async () =>
          failing
            ? '{"message":"x","errors":["Can not approve your own pull request"]}'
            : '{"id":7}',
      };
    };
    expect(submitReview(ref, "h", "APPROVE", "", draft, fn)).rejects.toThrow(
      /Can not approve your own pull request/,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.map((s) => `${s.method ?? "POST"} ${s.url}`)).toEqual([
      "POST /repos/o/r/pulls/42/reviews",
      "POST /repos/o/r/pulls/42/reviews/7/events",
      "DELETE /repos/o/r/pulls/42/reviews/7",
    ]);
  });

  test("cleanup failing does not replace the real error", async () => {
    const fn: FetchLike = async (url) => {
      if (url.endsWith("/events"))
        return { ok: false, status: 422, text: async () => '{"message":"the real reason"}' };
      if (url.endsWith("/reviews/7")) throw new Error("delete blew up");
      return { ok: true, status: 200, text: async () => '{"id":7}' };
    };
    expect(submitReview(ref, "h", "APPROVE", "", draft, fn)).rejects.toThrow(/the real reason/);
  });

  test("a single comment goes to the comments endpoint", async () => {
    const { fn, sent } = recorder();
    await postComment(ref, "headsha", "a.md", { side: "RIGHT", line: 7 }, "just this", fn);
    expect(sent[0].url).toBe("/repos/o/r/pulls/42/comments");
    expect(sent[0].body).toEqual({
      commit_id: "headsha",
      path: "a.md",
      line: 7,
      side: "RIGHT",
      body: "just this",
    });
  });

  test("a 403 names the permission the token is missing", async () => {
    const { fn } = recorder(403, '{"message":"Resource not accessible by personal access token"}');
    expect(submitReview(ref, "h", "APPROVE", "", draft, fn)).rejects.toThrow(
      /Pull requests: write/,
    );
  });

  test("a 422 quotes GitHub when it names the field", async () => {
    const { fn } = recorder(
      422,
      '{"message":"Validation Failed","errors":[{"message":"line must be part of the diff"}]}',
    );
    expect(submitReview(ref, "h", "COMMENT", "s", draft, fn)).rejects.toThrow(
      /line must be part of the diff/,
    );
  });

  /**
   * The shape GitHub actually sent for a verdict on your own pull
   * request. Read as `errors[0].message` it is undefined, and the reason
   * was replaced by a guess that the diff had moved — which sent the
   * reader off to reload a diff that was already current.
   */
  test("a 422 whose errors are plain strings is still quoted", async () => {
    const { fn } = recorder(
      422,
      '{"message":"Unprocessable Entity","errors":["Review Can not request changes on your own pull request"]}',
    );
    const err = submitReview(ref, "h", "REQUEST_CHANGES", "s", draft, fn);
    expect(err).rejects.toThrow(/Can not request changes on your own pull request/);
    expect(err).rejects.not.toThrow(/probably moved/);
  });

  test("several reasons are all reported", async () => {
    const { fn } = recorder(422, '{"message":"x","errors":["first reason","second reason"]}');
    expect(submitReview(ref, "h", "COMMENT", "s", draft, fn)).rejects.toThrow(
      /first reason; second reason/,
    );
  });

  // Only then is a guess the best we can do.
  test("a 422 with no reason at all falls back to the stale-diff guess", async () => {
    const { fn } = recorder(422, '{"message":""}');
    expect(submitReview(ref, "h", "COMMENT", "s", draft, fn)).rejects.toThrow(/may have moved/);
  });

  test("a network failure says the draft is safe", async () => {
    const fn: FetchLike = async () => {
      throw new Error("offline");
    };
    expect(submitReview(ref, "h", "APPROVE", "", draft, fn)).rejects.toThrow(/draft is intact/);
  });
});
