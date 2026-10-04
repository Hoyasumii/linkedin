import { LinkedInAuthError, LinkedInConfigError, LinkedInTimeoutError, apiErrorFromBody, redact } from "./errors";

/** Answers the access token to send; called once per request, so a token saved meanwhile is picked up. */
export type AccessTokenSource = string | (() => string | Promise<string>);

/** What one client instance sends every request with. */
export interface TransportConfig {
  /** `https://api.linkedin.com` (another origin in tests), without a trailing slash. */
  baseUrl: string;
  accessToken: AccessTokenSource;
  /** The `LinkedIn-Version` header, `YYYYMM`. */
  apiVersion: string;
  /** Timeout per request, in ms; `0` or `Infinity` turn it off. */
  timeoutMs: number;
  fetch: typeof fetch;
}

/**
 * The `RequestInit` the generated functions (src/generated/endpoints.ts) pass along, plus the client's
 * {@link TransportConfig}: the client binds it into every call's options.
 */
export type TransportInit = RequestInit & { transport?: TransportConfig };

/** `path` against the base URL; an absolute URL (an upload URL) is kept as is. */
function resolveUrl(config: TransportConfig, path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${config.baseUrl}${path}`;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0];
  }
}

/**
 * Whether the token may go to `url`: LinkedIn's own hosts (upload URLs live on www.linkedin.com) and
 * the configured base URL's origin. Anything else gets the request without it.
 */
export function sendsTokenTo(url: string, baseUrl: string): boolean {
  try {
    const target = new URL(url);
    if (target.origin === new URL(baseUrl).origin) return true;
    return (
      target.protocol === "https:" && (target.hostname === "linkedin.com" || target.hostname.endsWith(".linkedin.com"))
    );
  } catch {
    return false;
  }
}

async function tokenOf(config: TransportConfig): Promise<string> {
  const token = typeof config.accessToken === "function" ? await config.accessToken() : config.accessToken;
  if (!token) throw new LinkedInAuthError("no LinkedIn access token: sign in with `linkedin mcp config --web`");
  return token;
}

interface Sent {
  response: Response;
  method: string;
  path: string;
  token: string;
}

async function send(url: string, init: TransportInit): Promise<Sent> {
  const { transport: config, ...request } = init;
  if (!config) {
    throw new LinkedInConfigError("no transport configuration: call the operations through createLinkedInClient()");
  }
  const target = resolveUrl(config, url);
  const method = (request.method ?? "GET").toUpperCase();
  const path = pathOf(target);
  const limited = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0;
  const timeout = limited ? AbortSignal.timeout(config.timeoutMs) : undefined;
  const signal = timeout && request.signal ? AbortSignal.any([timeout, request.signal]) : (timeout ?? request.signal);
  const headers = new Headers(request.headers);
  const token = await tokenOf(config);
  if (sendsTokenTo(target, config.baseUrl)) headers.set("Authorization", `Bearer ${token}`);
  if (path.startsWith("/rest/")) {
    headers.set("LinkedIn-Version", config.apiVersion);
    headers.set("X-Restli-Protocol-Version", "2.0.0");
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  try {
    const response = await config.fetch(target, { ...request, method, headers, signal });
    return { response, method, path, token };
  } catch (error) {
    if (timeout?.aborted) throw new LinkedInTimeoutError(method, path, config.timeoutMs);
    throw error;
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  if ((response.headers.get("content-type") ?? "").includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/** Throws for a non-2xx answer: {@link LinkedInAuthError} on 401, {@link LinkedInApiError} otherwise. */
async function check({ response, method, path, token }: Sent): Promise<unknown> {
  const body = await readBody(response);
  if (response.ok) return body;
  const error = apiErrorFromBody({ status: response.status, method, path }, body, [token]);
  if (response.status === 401) {
    throw new LinkedInAuthError(
      `LinkedIn refused the access token (${error.message}): it expired or was revoked. ` +
        "Sign in again with `linkedin mcp config --web`."
    );
  }
  throw error;
}

/**
 * orval's mutator: every generated operation sends through it. It adds the token and LinkedIn's
 * versioning headers, applies the timeout, parses the JSON answer and throws on a non-2xx status,
 * with the token masked. A 201 without a body (Rest.li's create) answers `{ id }` from `x-restli-id`.
 */
export async function customFetch<T>(url: string, init: TransportInit): Promise<T> {
  const sent = await send(url, init);
  const body = await check(sent);
  if (body === undefined) {
    const id = sent.response.headers.get("x-restli-id");
    if (id) return { id: decodeURIComponent(id) } as T;
  }
  return body as T;
}

/**
 * PUTs bytes to an upload URL from an `initializeUpload` answer. Answers the `ETag` the upload
 * returned (without quotes), which a video's `finalizeUpload` needs for every part.
 */
export async function uploadBytes(
  url: string,
  data: Uint8Array,
  config: TransportConfig,
  options: { contentType?: string; signal?: AbortSignal } = {}
): Promise<string | undefined> {
  const sent = await send(url, {
    method: "PUT",
    headers: { "Content-Type": options.contentType ?? "application/octet-stream", Accept: "*/*" },
    body: data,
    signal: options.signal,
    transport: config,
  });
  try {
    await check(sent);
  } catch (error) {
    // An upload URL carries a signed token in its query string: never echo it.
    if (error instanceof Error) error.message = redact(error.message, [url, new URL(url).search]) as string;
    throw error;
  }
  const etag = sent.response.headers.get("etag");
  return etag ? etag.replace(/^W\//, "").replace(/^"|"$/g, "") : undefined;
}
