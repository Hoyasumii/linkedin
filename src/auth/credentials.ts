import * as fs from "node:fs";
import * as path from "node:path";
import { LinkedInAuthError } from "../errors";
import { readJsonFile, writeJsonFile } from "../fs-util";
import type { UserInfo } from "../generated/model";
import { type AppCredentials, type TokenResponse, refreshAccessToken } from "./oauth";

/** The signed-in member and their token, as `linkedin mcp config` saves them. */
export interface Credentials {
  accessToken: string;
  /** ISO 8601. */
  expiresAt: string;
  refreshToken?: string;
  /** ISO 8601. */
  refreshTokenExpiresAt?: string;
  scopes: string[];
  /** `urn:li:person:<sub>`: the author of every post. */
  personUrn: string;
  /** The member's name, from OpenID Connect `userinfo`. */
  name?: string;
  /** ISO 8601. */
  savedAt: string;
}

/** Refresh, or warn, this long before a token expires. */
export const EXPIRY_MARGIN_MS = 5 * 60_000;

/** `credentials.json` beside the saved `.env`. */
export function credentialsPath(configFile: string): string {
  return path.join(path.dirname(configFile), "credentials.json");
}

function isCredentials(value: unknown): value is Credentials {
  const data = value as Partial<Credentials> | undefined;
  return (
    typeof data === "object" &&
    data !== null &&
    typeof data.accessToken === "string" &&
    data.accessToken !== "" &&
    typeof data.expiresAt === "string" &&
    typeof data.personUrn === "string" &&
    Array.isArray(data.scopes)
  );
}

/** The saved credentials, or `undefined` when there are none (or the file is not ours). */
export function readCredentials(file: string): Credentials | undefined {
  const data = readJsonFile(file);
  return isCredentials(data) ? data : undefined;
}

/** Saves the credentials with mode 0600, in one rename. */
export function writeCredentials(file: string, credentials: Credentials): void {
  writeJsonFile(file, credentials);
}

/** Removes the saved credentials; `false` when there were none. */
export function deleteCredentials(file: string): boolean {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Credentials from a token answer and the member it belongs to. */
export function credentialsFrom(token: TokenResponse, member: UserInfo, now = Date.now()): Credentials {
  return {
    accessToken: token.access_token,
    expiresAt: new Date(now + token.expires_in * 1000).toISOString(),
    ...(token.refresh_token
      ? {
          refreshToken: token.refresh_token,
          ...(token.refresh_token_expires_in
            ? { refreshTokenExpiresAt: new Date(now + token.refresh_token_expires_in * 1000).toISOString() }
            : {}),
        }
      : {}),
    scopes: (token.scope ?? "").split(/[\s,]+/).filter(Boolean),
    personUrn: `urn:li:person:${member.sub}`,
    name: member.name,
    savedAt: new Date(now).toISOString(),
  };
}

/** Whether the token is past (or within {@link EXPIRY_MARGIN_MS} of) its expiry. */
export function isExpired(credentials: Credentials, now = Date.now()): boolean {
  return Date.parse(credentials.expiresAt) - EXPIRY_MARGIN_MS <= now;
}

/** Whole days left before the token expires, never below 0. */
export function daysLeft(credentials: Credentials, now = Date.now()): number {
  return Math.max(0, Math.floor((Date.parse(credentials.expiresAt) - now) / 86_400_000));
}

export interface CredentialSourceOptions {
  /** The app, to refresh with when LinkedIn gave a refresh token. */
  app?: AppCredentials;
  fetch?: typeof fetch;
  tokenUrl?: string;
  now?: () => number;
}

/**
 * Reads `credentials.json` on every call, so a login made while the MCP server runs is picked up
 * without a restart. An expired token is refreshed when a refresh token and the app are at hand;
 * otherwise it throws {@link LinkedInAuthError}, asking for a new login.
 */
export function credentialSource(file: string, options: CredentialSourceOptions = {}): () => Promise<Credentials> {
  const now = options.now ?? Date.now;
  return async () => {
    const saved = readCredentials(file);
    if (!saved) {
      throw new LinkedInAuthError("not signed in to LinkedIn: run `linkedin mcp config --web` to sign in");
    }
    if (!isExpired(saved, now())) return saved;
    const refreshable =
      saved.refreshToken &&
      options.app &&
      (!saved.refreshTokenExpiresAt || Date.parse(saved.refreshTokenExpiresAt) > now());
    if (!refreshable) {
      throw new LinkedInAuthError(
        `the LinkedIn sign-in expired on ${saved.expiresAt.slice(0, 10)}: run \`linkedin mcp config --web\` to sign in again`
      );
    }
    const token = await refreshAccessToken({
      ...(options.app as AppCredentials),
      refreshToken: saved.refreshToken as string,
      fetch: options.fetch,
      tokenUrl: options.tokenUrl,
    });
    const at = now();
    const refreshed: Credentials = {
      ...saved,
      accessToken: token.access_token,
      expiresAt: new Date(at + token.expires_in * 1000).toISOString(),
      refreshToken: token.refresh_token ?? saved.refreshToken,
      ...(token.refresh_token_expires_in
        ? { refreshTokenExpiresAt: new Date(at + token.refresh_token_expires_in * 1000).toISOString() }
        : {}),
      savedAt: new Date(at).toISOString(),
    };
    writeCredentials(file, refreshed);
    return refreshed;
  };
}
