import { randomBytes, timingSafeEqual } from "node:crypto";
import { IncomingMessage, Server, ServerResponse, createServer } from "node:http";
import {
  type Credentials,
  credentialsFrom,
  credentialsPath,
  readCredentials,
  writeCredentials,
} from "../../auth/credentials";
import { authorizationUrl, exchangeCode, newState } from "../../auth/oauth";
import { createLinkedInClient } from "../../client";
import { LinkedInApiError } from "../../errors";
import {
  CONFIG_KEYS,
  ConfigKey,
  ConfigValues,
  checkApiVersion,
  parsePort,
  readEnvFile,
  redirectUri,
  writeEnvFile,
} from "../../mcp/config";
import { failedPage, formPage, messagePage, signedInPage } from "./config-page";

const MAX_FORM_BYTES = 64 * 1024;
export const CONFIG_UI_TIMEOUT_MS = 10 * 60 * 1000;

/** Why `value` cannot be saved as `key`, or `undefined` when it can. Blank values are the caller's concern. */
export function configValueError(key: ConfigKey, value: string): string | undefined {
  try {
    if (key === "LINKEDIN_REDIRECT_PORT") parsePort(value);
    if (key === "LINKEDIN_API_VERSION") checkApiVersion(value);
  } catch (error) {
    return (error as Error).message;
  }
  if (key === "LINKEDIN_CLIENT_ID" && !/^[\w-]+$/.test(value))
    return "The Client ID has only letters, digits, - and _.";
  return undefined;
}

/**
 * The configuration to save from what was entered, the rules for every front end: a blank secret
 * keeps the saved one; other blanks clear the setting (it falls back to its default). The app's
 * Client ID and Client Secret are required.
 */
export function valuesFromInput(input: ConfigValues, saved: ConfigValues): { values: ConfigValues; error?: string } {
  const text = (key: ConfigKey): string | undefined => (input[key] ?? "").trim() || undefined;
  const values: ConfigValues = {
    LINKEDIN_CLIENT_ID: text("LINKEDIN_CLIENT_ID"),
    LINKEDIN_CLIENT_SECRET: text("LINKEDIN_CLIENT_SECRET") ?? saved.LINKEDIN_CLIENT_SECRET,
    LINKEDIN_REDIRECT_PORT: text("LINKEDIN_REDIRECT_PORT"),
    LINKEDIN_API_VERSION: text("LINKEDIN_API_VERSION"),
  };
  if (!values.LINKEDIN_CLIENT_ID) return { values, error: "The Client ID is required." };
  if (!values.LINKEDIN_CLIENT_SECRET) return { values, error: "The Client Secret is required." };
  for (const key of CONFIG_KEYS) {
    const error = values[key] ? configValueError(key, values[key] as string) : undefined;
    if (error) return { values, error };
  }
  return { values };
}

/** What LinkedIn's `error` on the callback means, in words the user can act on. */
export function describeAuthorizationError(error: string, description: string | null): string {
  const detail = description ? ` (${description})` : "";
  switch (error) {
    case "user_cancelled_login":
    case "user_cancelled_authorize":
      return "The sign-in was cancelled on LinkedIn.";
    case "unauthorized_scope_error":
      return (
        `LinkedIn refused a permission${detail}. In your app's Products tab, add both 'Share on LinkedIn' and ` +
        "'Sign In with LinkedIn using OpenID Connect', then try again."
      );
    case "invalid_redirect_uri":
    case "redirect_uri_mismatch":
      return `LinkedIn refused the redirect URL${detail}. Add it exactly as shown to the app's Auth tab.`;
    default:
      return `LinkedIn answered '${error}'${detail}.`;
  }
}

function sameToken(given: string | null | undefined, token: string): boolean {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
  res
    .writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...headers,
    })
    .end(html);
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_FORM_BYTES) throw new RangeError("Form too large.");
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export interface LoginUiOptions {
  /** The port LinkedIn redirects to; the app's redirect URL must name it. */
  port: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Other endpoints (tests). */
  tokenUrl?: string;
  apiBaseUrl?: string;
  authorizeUrl?: string;
}

export type LoginOutcome = { kind: "signed-in"; credentials: Credentials } | { kind: "timeout" };

export interface LoginUi {
  /** The settings form, token included (`--web`). */
  formUrl: string;
  /** Straight to LinkedIn's sign-in, with the saved app (the terminal flow). */
  loginUrl: string;
  /** Settles once the member signed in, or nobody did in time. */
  done: Promise<LoginOutcome>;
  close(): Promise<void>;
}

/**
 * Serves the settings form and LinkedIn's OAuth redirect on `localhost:<port>` until the member has
 * signed in: `/` (the form) → `/save` → `/login` → LinkedIn → `/callback` → saved `credentials.json`.
 *
 * A random token in every URL of ours (and in a hidden field) plus a `Host` check keep other web
 * pages from reading the form or posting to it; LinkedIn's redirect is checked by its one-time `state`.
 */
export async function startLoginUi(configFile: string, options: LoginUiOptions): Promise<LoginUi> {
  const token = randomBytes(24).toString("hex");
  const port = options.port;
  const redirect = redirectUri(port);
  const credentialsFile = credentialsPath(configFile);
  const states = new Set<string>();
  let finish: (outcome: LoginOutcome) => void = () => undefined;
  const done = new Promise<LoginOutcome>((resolve) => {
    finish = resolve;
  });
  const formUrl = `http://localhost:${port}/?t=${token}`;
  const loginUrl = `http://localhost:${port}/login?t=${token}`;

  const form = (res: ServerResponse, status: number, values: ConfigValues, error?: string): void => {
    const saved = readEnvFile(configFile);
    send(
      res,
      status,
      formPage({
        token,
        values,
        saved,
        configFile,
        redirectUri: redirect,
        credentials: readCredentials(credentialsFile),
        error,
      })
    );
  };

  const signIn = async (code: string): Promise<Credentials> => {
    const saved = readEnvFile(configFile);
    const exchanged = await exchangeCode({
      clientId: saved.LINKEDIN_CLIENT_ID ?? "",
      clientSecret: saved.LINKEDIN_CLIENT_SECRET ?? "",
      code,
      redirectUri: redirect,
      fetch: options.fetch,
      tokenUrl: options.tokenUrl,
    });
    const member = await createLinkedInClient({
      accessToken: exchanged.access_token,
      fetch: options.fetch,
      baseUrl: options.apiBaseUrl,
    }).me();
    const credentials = credentialsFrom(exchanged, member);
    if (credentials.scopes.length > 0 && !credentials.scopes.includes("w_member_social")) {
      throw new Error(
        "LinkedIn signed you in without the w_member_social permission, so posting would fail. Add the " +
          "'Share on LinkedIn' product to your app, then sign in again."
      );
    }
    writeCredentials(credentialsFile, credentials);
    return credentials;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const host = req.headers.host ?? "";
    if (![`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(host)) {
      send(res, 403, messagePage("Access denied", "Unexpected host."));
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}`);

    if (req.method === "GET" && url.pathname === "/") {
      if (!sameToken(url.searchParams.get("t"), token)) {
        send(res, 403, messagePage("Access denied", "Open the link that `linkedin mcp config` printed."));
        return;
      }
      form(res, 200, readEnvFile(configFile));
      return;
    }

    if (req.method === "POST" && url.pathname === "/save") {
      let submitted: URLSearchParams;
      try {
        submitted = await readForm(req);
      } catch (error) {
        send(res, 413, messagePage("Error", error instanceof Error ? error.message : String(error)));
        return;
      }
      if (!sameToken(submitted.get("t"), token)) {
        send(res, 403, messagePage("Access denied", "Invalid token."));
        return;
      }
      const saved = readEnvFile(configFile);
      // The port is not on the form: it is the one this server listens on, kept as saved.
      const input: ConfigValues = {
        ...Object.fromEntries(CONFIG_KEYS.map((key) => [key, submitted.get(key) ?? ""])),
        LINKEDIN_REDIRECT_PORT: saved.LINKEDIN_REDIRECT_PORT,
      };
      const { values, error } = valuesFromInput(input, saved);
      if (error) {
        form(res, 400, values, error);
        return;
      }
      writeEnvFile(configFile, values);
      res.writeHead(303, { Location: `/login?t=${token}`, "Cache-Control": "no-store" }).end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/login") {
      if (!sameToken(url.searchParams.get("t"), token)) {
        send(res, 403, messagePage("Access denied", "Open the link that `linkedin mcp config` printed."));
        return;
      }
      const saved = readEnvFile(configFile);
      if (!saved.LINKEDIN_CLIENT_ID || !saved.LINKEDIN_CLIENT_SECRET) {
        form(res, 400, saved, "Save your app's Client ID and Client Secret first.");
        return;
      }
      const state = newState();
      states.add(state);
      const target = authorizationUrl({ clientId: saved.LINKEDIN_CLIENT_ID, redirectUri: redirect, state });
      const location = options.authorizeUrl ? target.replace(/^[^?]+/, options.authorizeUrl) : target;
      res.writeHead(302, { Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/callback") {
      const state = url.searchParams.get("state");
      if (!state || !states.has(state)) {
        send(res, 400, failedPage("This sign-in link is stale or was not started here. Start it again.", formUrl));
        return;
      }
      states.delete(state);
      const error = url.searchParams.get("error");
      if (error) {
        send(
          res,
          400,
          failedPage(describeAuthorizationError(error, url.searchParams.get("error_description")), formUrl)
        );
        return;
      }
      const code = url.searchParams.get("code");
      if (!code) {
        send(res, 400, failedPage("LinkedIn came back without an authorization code.", formUrl));
        return;
      }
      let credentials: Credentials;
      try {
        credentials = await signIn(code);
      } catch (failure) {
        const message =
          failure instanceof LinkedInApiError && failure.path.endsWith("/accessToken")
            ? `LinkedIn refused the code: ${failure.message}. Check the Client Secret, and that the redirect URL is ${redirect}.`
            : failure instanceof Error
              ? failure.message
              : String(failure);
        send(res, 400, failedPage(message, formUrl));
        return;
      }
      send(res, 200, signedInPage(credentials), { Connection: "close" });
      res.on("finish", () => finish({ kind: "signed-in", credentials }));
      return;
    }

    send(res, 404, messagePage("Not found", "This page does not exist."));
  };

  const listen = (address: string): Promise<Server | undefined> =>
    new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        handle(req, res).catch((error: unknown) => {
          if (!res.headersSent)
            send(res, 500, messagePage("Error", error instanceof Error ? error.message : String(error)));
        });
      });
      server.once("error", (error: NodeJS.ErrnoException) => {
        // `localhost` may resolve to either address: IPv6 is a bonus where it exists.
        if (address === "::1" && (error.code === "EADDRNOTAVAIL" || error.code === "EAFNOSUPPORT")) resolve(undefined);
        else if (error.code === "EADDRINUSE") {
          reject(
            new Error(
              `Port ${port} is in use, and LinkedIn redirects there. Free it, or pick another port with ` +
                "`linkedin mcp config --redirect-port <port>` and add that redirect URL to the app."
            )
          );
        } else reject(error);
      });
      server.listen(port, address, () => resolve(server));
    });

  const servers: Server[] = [];
  const primary = await listen("127.0.0.1");
  if (primary) servers.push(primary);
  try {
    const secondary = await listen("::1");
    if (secondary) servers.push(secondary);
  } catch (error) {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    throw error;
  }

  const timer = setTimeout(() => finish({ kind: "timeout" }), options.timeoutMs ?? CONFIG_UI_TIMEOUT_MS);
  timer.unref();
  const close = async (): Promise<void> => {
    clearTimeout(timer);
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          })
      )
    );
  };

  return { formUrl, loginUrl, done, close };
}
