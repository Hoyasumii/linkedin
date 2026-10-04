import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { credentialSource, credentialsPath } from "../auth/credentials";
import { createLinkedInClient, DEFAULT_API_VERSION, type LinkedInClient } from "../client";
import { renameWithRetry } from "../fs-util";
import type { PollOptions } from "../media";
import { PostRegistry, registryPath } from "../registry";

/** The keys the saved configuration holds, in the order they are written. */
export const CONFIG_KEYS = [
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
  "LINKEDIN_REDIRECT_PORT",
  "LINKEDIN_API_VERSION",
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];
export type ConfigValues = Partial<Record<ConfigKey, string>>;

/**
 * The port `linkedin mcp config` listens on for LinkedIn's redirect. The app's Authorized redirect
 * URL must name it exactly: `http://localhost:3769/callback`.
 */
export const DEFAULT_REDIRECT_PORT = 3769;

type Env = Record<string, string | undefined>;

function homeOf(env: Env): string {
  return env.HOME || env.USERPROFILE || os.homedir();
}

/**
 * The per-user directory the saved configuration lives in: `$XDG_CONFIG_HOME/linkedin`
 * (`~/.config/linkedin`) on Linux, `~/Library/Application Support/linkedin` on macOS and
 * `%APPDATA%\linkedin` on Windows.
 */
export function configDir(env: Env = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const appData = env.APPDATA || path.win32.join(homeOf(env), "AppData", "Roaming");
    return path.win32.join(appData, "linkedin");
  }
  if (platform === "darwin") return path.join(homeOf(env), "Library", "Application Support", "linkedin");
  return path.join(env.XDG_CONFIG_HOME || path.join(homeOf(env), ".config"), "linkedin");
}

/** The saved `.env`: `LINKEDIN_CONFIG` when set, otherwise `<configDir>/.env`. */
export function configFilePath(env: Env = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env.LINKEDIN_CONFIG) return path.resolve(env.LINKEDIN_CONFIG);
  const dir = configDir(env, platform);
  return platform === "win32" ? path.win32.join(dir, ".env") : path.join(dir, ".env");
}

function unquote(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
    const inner = value.slice(1, -1);
    return quote === '"' ? inner.replace(/\\n/g, "\n").replace(/\\(["\\])/g, "$1") : inner;
  }
  return value.replace(/\s+#.*$/, "");
}

/** `KEY=VALUE` lines, `#` comments and quoted values. Every key is kept, known or not. */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match) values[match[1]] = unquote(match[2].trim());
  }
  return values;
}

/** The saved configuration, or `{}` when there is no file yet. */
export function readEnvFile(file: string): ConfigValues {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const parsed = parseEnv(text);
  const values: ConfigValues = {};
  for (const key of CONFIG_KEYS) if (parsed[key] !== undefined && parsed[key] !== "") values[key] = parsed[key];
  return values;
}

function quote(value: string): string {
  return /^[\w.:/@+-]*$/.test(value) ? value : `"${value.replace(/(["\\])/g, "\\$1").replace(/\n/g, "\\n")}"`;
}

/**
 * Write the known keys, readable by the owner only, replacing the file in one rename. On Windows
 * the mode is a no-op: `%APPDATA%` is already limited to its user by ACL.
 */
export function writeEnvFile(file: string, values: ConfigValues): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const body =
    "# LinkedIn MCP server configuration, written by `linkedin mcp config`.\n" +
    "# The sign-in itself (the access token) is in credentials.json, beside this file.\n" +
    CONFIG_KEYS.filter((key) => values[key])
      .map((key) => `${key}=${quote(values[key] as string)}\n`)
      .join("");
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, body, { mode: 0o600 });
  renameWithRetry(temporary, file);
  fs.chmodSync(file, 0o600);
}

/** Parse and range-check a port. */
export function parsePort(value: string | number, key = "LINKEDIN_REDIRECT_PORT"): number {
  const port = typeof value === "number" ? value : /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError(`${key} must be an integer from 1 to 65535 (received '${String(value)}').`);
  }
  return port;
}

/** A `LinkedIn-Version`: `YYYYMM`. */
export function checkApiVersion(value: string): string {
  if (!/^20\d{2}(0[1-9]|1[0-2])$/.test(value)) {
    throw new TypeError(`LINKEDIN_API_VERSION must be YYYYMM, like ${DEFAULT_API_VERSION} (received '${value}').`);
  }
  return value;
}

export interface McpConfig {
  /** `""` until `linkedin mcp config` saves one. */
  clientId: string;
  clientSecret: string;
  redirectPort: number;
  apiVersion: string;
  /** The saved `.env`; `credentials.json` and `posts.json` sit beside it. */
  configFile: string;
  /**
   * `LINKEDIN_ACCESS_TOKEN` from the environment: used instead of the saved sign-in (scripts, CI).
   * Never saved.
   */
  accessToken?: string;
  /** `LINKEDIN_PERSON_URN`, with {@link accessToken}: skips the `userinfo` call. */
  personUrn?: string;
}

/**
 * The server's settings, each from the first source that has it: **process environment > saved
 * `.env` > default**.
 */
export function resolveMcpConfig(sources: { env?: Env; file?: ConfigValues; configFile: string }): McpConfig {
  const { env = {}, file = {} } = sources;
  const pick = (key: ConfigKey): string | undefined => {
    for (const value of [env[key], file[key]]) {
      const text = value === undefined ? "" : String(value).trim();
      if (text !== "") return text;
    }
    return undefined;
  };
  const accessToken = env.LINKEDIN_ACCESS_TOKEN?.trim() || undefined;
  const personUrn = env.LINKEDIN_PERSON_URN?.trim() || undefined;
  return {
    clientId: pick("LINKEDIN_CLIENT_ID") ?? "",
    clientSecret: pick("LINKEDIN_CLIENT_SECRET") ?? "",
    redirectPort: parsePort(pick("LINKEDIN_REDIRECT_PORT") ?? DEFAULT_REDIRECT_PORT),
    apiVersion: checkApiVersion(pick("LINKEDIN_API_VERSION") ?? DEFAULT_API_VERSION),
    configFile: sources.configFile,
    ...(accessToken ? { accessToken } : {}),
    ...(personUrn ? { personUrn } : {}),
  };
}

/** The redirect URL the LinkedIn app must list: `http://localhost:<port>/callback`. */
export function redirectUri(port: number): string {
  return `http://localhost:${port}/callback`;
}

/** What the MCP server works with: an SDK client, the post registry and where the sign-in lives. */
export interface LinkedInConnection {
  client: LinkedInClient;
  registry: PostRegistry;
  /** `credentials.json`, or `undefined` when an environment token is used instead. */
  credentialsFile?: string;
}

export interface ConnectionOverrides {
  fetch?: typeof fetch;
  /** Another API origin (tests). */
  baseUrl?: string;
  /** Another token endpoint (tests). */
  tokenUrl?: string;
  poll?: PollOptions;
  now?: () => number;
}

/**
 * The SDK client for a configuration: the environment token when set, otherwise the saved sign-in,
 * read again on every request and refreshed when LinkedIn gave a refresh token.
 */
export function connectionFor(config: McpConfig, overrides: ConnectionOverrides = {}): LinkedInConnection {
  const registry = new PostRegistry(registryPath(config.configFile));
  const common = {
    apiVersion: config.apiVersion,
    fetch: overrides.fetch,
    baseUrl: overrides.baseUrl,
    poll: overrides.poll,
  };
  if (config.accessToken) {
    return {
      client: createLinkedInClient({ ...common, accessToken: config.accessToken, author: config.personUrn }),
      registry,
    };
  }
  const credentialsFile = credentialsPath(config.configFile);
  const credentials = credentialSource(credentialsFile, {
    app:
      config.clientId && config.clientSecret
        ? { clientId: config.clientId, clientSecret: config.clientSecret }
        : undefined,
    fetch: overrides.fetch,
    tokenUrl: overrides.tokenUrl,
    now: overrides.now,
  });
  return {
    client: createLinkedInClient({
      ...common,
      accessToken: async () => (await credentials()).accessToken,
      author: async () => (await credentials()).personUrn,
    }),
    registry,
    credentialsFile,
  };
}
