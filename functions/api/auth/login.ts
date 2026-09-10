/** Start the GitHub sign-in: stash a state nonce, then hand off. */
import { COOKIE_STATE, writeCookie, safeReturnPath } from "../_policy";
import type { Env } from "../_github";

interface Ctx {
  request: Request;
  env: Env;
}

export const onRequestGet = async ({ request, env }: Ctx): Promise<Response> => {
  // No App registered means no sign-in: the route is closed rather than
  // merely unlinked, and it opens again the moment the secret is set.
  if (!env.GH_CLIENT_ID) return new Response("Sign-in is not configured.", { status: 404 });

  const url = new URL(request.url);
  const back = safeReturnPath(url.searchParams.get("return"));
  const nonce = crypto.randomUUID();
  const state = `${nonce}:${back}`;

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GH_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${url.origin}/api/auth/callback`);
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      // Ten minutes is plenty to click one button, and short enough that a
      // stale nonce can't be replayed later.
      "Set-Cookie": writeCookie(COOKIE_STATE, state, 600),
    },
  });
};
