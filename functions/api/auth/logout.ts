/** Drop the session cookies. */
import { COOKIE_ACCESS, COOKIE_REFRESH, clearCookie } from "../_policy";

export const onRequestGet = async (): Promise<Response> => {
  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", clearCookie(COOKIE_ACCESS));
  headers.append("Set-Cookie", clearCookie(COOKIE_REFRESH));
  return new Response(null, { status: 302, headers });
};
