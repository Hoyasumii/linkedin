import { randomBytes } from "node:crypto";
import { LinkedInAuthError, apiErrorFromBody } from "../errors";

/** LinkedIn's OAuth 2.0 endpoints (3-legged, authorization code). */
export const AUTHORIZATION_URL = "https://www.linkedin.com/oauth/v2/authorization";
export const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

/**
 * What the login asks for: `openid profile` (Sign In with LinkedIn using OpenID Connect) to know
 * who signed in, `w_member_social` (Share on LinkedIn) to create, edit and delete their posts.
 */
export const SCOPES = ["openid", "profile", "w_member_social"] as const;

/** An unguessable `state`, checked on the callback so another site cannot complete the login. */
export function newState(): string {
  return randomBytes(24).toString("hex");
}

export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
}

/** The page the member opens to sign in and grant the app its scopes. */
export function authorizationUrl(request: AuthorizationRequest): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    state: request.state,
    scope: (request.scopes ?? SCOPES).join(" "),
  });
  return `${AUTHORIZATION_URL}?${params}`;
}

/** LinkedIn's token answer. A refresh token comes only to apps LinkedIn enabled it for. */
export interface TokenResponse {
  access_token: string;
  /** Seconds; 5184000 (60 days) for a member token. */
  expires_in: number;
  scope?: string;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  id_token?: string;
}

export interface AppCredentials {
  clientId: string;
  clientSecret: string;
}

async function requestToken(
  form: Record<string, string>,
  app: AppCredentials,
  fetchImpl: typeof fetch,
  tokenUrl: string
): Promise<TokenResponse> {
  const body = new URLSearchParams({ ...form, client_id: app.clientId, client_secret: app.clientSecret });
  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Kept as text for the error below.
  }
  const secrets = [app.clientSecret, form.code, form.refresh_token].filter((value): value is string => !!value);
  if (!response.ok) {
    throw apiErrorFromBody(
      { status: response.status, method: "POST", path: new URL(tokenUrl).pathname },
      parsed,
      secrets
    );
  }
  const token = parsed as Partial<TokenResponse>;
  if (typeof token?.access_token !== "string" || typeof token.expires_in !== "number") {
    throw new LinkedInAuthError("LinkedIn's token endpoint answered without an access_token");
  }
  return token as TokenResponse;
}

export interface CodeExchange extends AppCredentials {
  code: string;
  redirectUri: string;
  fetch?: typeof fetch;
  /** Another token endpoint (tests). */
  tokenUrl?: string;
}

/** Trades the callback's `code` for an access token. The redirect URI must be the one the code was asked with. */
export function exchangeCode(exchange: CodeExchange): Promise<TokenResponse> {
  return requestToken(
    { grant_type: "authorization_code", code: exchange.code, redirect_uri: exchange.redirectUri },
    exchange,
    exchange.fetch ?? fetch,
    exchange.tokenUrl ?? TOKEN_URL
  );
}

export interface TokenRefresh extends AppCredentials {
  refreshToken: string;
  fetch?: typeof fetch;
  tokenUrl?: string;
}

/** A new access token from a refresh token (only apps LinkedIn enabled programmatic refresh for get one). */
export function refreshAccessToken(refresh: TokenRefresh): Promise<TokenResponse> {
  return requestToken(
    { grant_type: "refresh_token", refresh_token: refresh.refreshToken },
    refresh,
    refresh.fetch ?? fetch,
    refresh.tokenUrl ?? TOKEN_URL
  );
}
