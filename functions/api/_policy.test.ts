import { test, expect, describe } from "bun:test";
import {
  isAllowed,
  readCookie,
  writeCookie,
  clearCookie,
  shouldRefresh,
  safeReturnPath,
} from "./_policy";

describe("isAllowed", () => {
  test("passes the endpoints reading a PR needs", () => {
    expect(isAllowed("/user")).toBe(true);
    expect(isAllowed("/repos/o/r/pulls/42")).toBe(true);
    expect(isAllowed("/repos/o/r/pulls/42/files?per_page=100&page=1")).toBe(true);
    expect(isAllowed("/repos/o/r/contents/docs/guide.md?ref=abc")).toBe(true);
    expect(isAllowed("/repos/o/r/git/blobs/0123456789abcdef")).toBe(true);
  });

  test("refuses everything else, including writes and unrelated reads", () => {
    expect(isAllowed("/repos/o/r/pulls/42/reviews")).toBe(false);
    expect(isAllowed("/repos/o/r/issues")).toBe(false);
    expect(isAllowed("/user/repos")).toBe(false);
    expect(isAllowed("/orgs/o/members")).toBe(false);
    expect(isAllowed("/gists")).toBe(false);
  });

  test("refuses path traversal and malformed paths", () => {
    expect(isAllowed("/repos/o/r/contents/../../../user")).toBe(false);
    expect(isAllowed("/repos/o/r/contents/..%2f")).toBe(false); // ".." anywhere is enough
    expect(isAllowed("repos/o/r/pulls/1")).toBe(false);
    expect(isAllowed("/repos/o/r/contents/a\\b")).toBe(false);
  });

  test("a pull number must be a number", () => {
    expect(isAllowed("/repos/o/r/pulls/abc")).toBe(false);
  });
});

describe("cookies", () => {
  test("reads one value out of a header", () => {
    expect(readCookie("a=1; gh_at=tok%20en; b=2", "gh_at")).toBe("tok en");
    expect(readCookie("a=1", "gh_at")).toBeNull();
    expect(readCookie(null, "gh_at")).toBeNull();
  });

  test("does not match a name by suffix", () => {
    expect(readCookie("xgh_at=nope", "gh_at")).toBeNull();
  });

  test("every cookie written is httpOnly, Secure and same-site", () => {
    const c = writeCookie("gh_at", "value", 3600);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Max-Age=3600");
  });

  test("a negative lifetime is clamped, not emitted as negative", () => {
    expect(writeCookie("gh_at", "v", -50)).toContain("Max-Age=0");
  });

  test("clearing writes an immediately-expiring empty cookie", () => {
    expect(clearCookie("gh_at")).toBe("gh_at=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  });
});

describe("shouldRefresh", () => {
  test("only when there is a refresh token to spend", () => {
    expect(shouldRefresh(401, true)).toBe(true);
    expect(shouldRefresh(401, false)).toBe(false);
    expect(shouldRefresh(403, true)).toBe(true);
    expect(shouldRefresh(200, true)).toBe(false);
    expect(shouldRefresh(404, true)).toBe(false);
  });
});

describe("safeReturnPath", () => {
  test("keeps same-origin paths", () => {
    expect(safeReturnPath("/docs")).toBe("/docs");
  });

  test("refuses anything that could leave the origin", () => {
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("https://evil.example")).toBe("/");
    expect(safeReturnPath(null)).toBe("/");
  });
});
