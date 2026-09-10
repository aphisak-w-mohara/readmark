/** Finish sign-in: verify the state nonce, swap the code, set the cookies. */
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  COOKIE_STATE,
  clearCookie,
  readCookie,
  safeReturnPath,
  writeCookie,
} from "../_policy";
import { exchangeCode, type Env } from "../_github";

interface Ctx {
  request: Request;
  env: Env;
}

const fail = (msg: string) =>
  new Response(`Sign-in failed: ${msg}`, {
    status: 400,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });

export const onRequestGet = async ({ request, env }: Ctx): Promise<Response> => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(request.headers.get("Cookie"), COOKIE_STATE);

  if (!code) return fail("GitHub sent no code.");
  if (!state || !expected || state !== expected) return fail("state mismatch.");

  let tokens;
  try {
    tokens = await exchangeCode(env, code, `${url.origin}/api/auth/callback`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "token exchange failed.");
  }

  const headers = new Headers({ Location: safeReturnPath(state.split(":").slice(1).join(":")) });
  // A minute of headroom, so a request in flight never races the expiry.
  headers.append(
    "Set-Cookie",
    writeCookie(COOKIE_ACCESS, tokens.accessToken, tokens.expiresIn - 60),
  );
  if (tokens.refreshToken)
    headers.append(
      "Set-Cookie",
      writeCookie(COOKIE_REFRESH, tokens.refreshToken, tokens.refreshExpiresIn),
    );
  headers.append("Set-Cookie", clearCookie(COOKIE_STATE));
  return new Response(null, { status: 302, headers });
};
