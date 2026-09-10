/**
 * The GitHub side of the session: swapping a code for a token, and keeping
 * that token fresh. User-access tokens expire in eight hours and rotate
 * their refresh token, so this runs far more often than the login does.
 */

export interface Env {
  GH_CLIENT_ID: string;
  GH_CLIENT_SECRET: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Seconds until the refresh token expires. */
  refreshExpiresIn: number;
}

interface RawToken {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

const TOKEN_URL = "https://github.com/login/oauth/access_token";

async function exchange(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = (await res.json()) as RawToken;
  if (!raw.access_token)
    throw new Error(raw.error_description || raw.error || "GitHub did not return a token.");
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? "",
    // A GitHub App token is short-lived; an OAuth App one has no expiry at
    // all, in which case treat it as good for a day and let 401 handle it.
    expiresIn: raw.expires_in ?? 86_400,
    refreshExpiresIn: raw.refresh_token_expires_in ?? 15_552_000,
  };
}

/** Swap an authorization code for a token set. */
export function exchangeCode(env: Env, code: string, redirectUri: string): Promise<TokenSet> {
  return exchange({
    client_id: env.GH_CLIENT_ID,
    client_secret: env.GH_CLIENT_SECRET,
    code,
    redirect_uri: redirectUri,
  });
}

/** Swap a refresh token for a fresh token set. */
export function refresh(env: Env, refreshToken: string): Promise<TokenSet> {
  return exchange({
    client_id: env.GH_CLIENT_ID,
    client_secret: env.GH_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}
