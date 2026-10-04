/** Keys whose value never leaves the SDK in an error, a log or an exposed `body`. */
const SECRET_KEYS = new Set([
  "authorization",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
  "client_secret",
  "clientsecret",
  "token",
]);
const MASK = "***";

/**
 * Minimum length of a secret for its literal occurrences to be masked: a short value (e.g. `k` in a
 * test) would erase bits of any message. Real tokens are much longer.
 */
const MIN_LITERAL_SECRET = 8;

/**
 * Copies `value`, replacing with `***` the values of sensitive keys and any literal occurrence of
 * the known secrets (`secrets`), inside strings too.
 */
export function redact(value: unknown, secrets: readonly string[] = []): unknown {
  const known = secrets.filter((s) => s.length >= MIN_LITERAL_SECRET);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      let out = v;
      for (const s of known) out = out.split(s).join(MASK);
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, inner] of Object.entries(v)) {
        out[k] = SECRET_KEYS.has(k.toLowerCase()) && inner != null ? MASK : walk(inner);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}

interface LinkedInApiErrorInit {
  status: number;
  method: string;
  path: string;
  message: string;
  serviceErrorCode?: number;
  code?: string;
  body?: unknown;
}

/**
 * A non-2xx answer from LinkedIn. Rest.li answers `{ status, serviceErrorCode?, code?, message }`;
 * OAuth answers `{ error, error_description }`.
 */
export class LinkedInApiError extends Error {
  override readonly name: string = "LinkedInApiError";
  readonly status: number;
  readonly method: string;
  /** The path without the query string. */
  readonly path: string;
  /** LinkedIn's numeric error code (e.g. 100 for a missing permission), when it sent one. */
  readonly serviceErrorCode?: number;
  /** LinkedIn's symbolic error code (e.g. `ACCESS_DENIED`), when it sent one. */
  readonly code?: string;
  /** The response body, with every secret already masked. */
  readonly body?: unknown;

  constructor(init: LinkedInApiErrorInit) {
    super(`${init.method} ${init.path} → ${init.status}: ${init.message}`);
    this.status = init.status;
    this.method = init.method;
    this.path = init.path;
    this.serviceErrorCode = init.serviceErrorCode;
    this.code = init.code;
    this.body = init.body;
  }
}

/**
 * No usable access token: none saved, expired, or refused by LinkedIn (401). `linkedin mcp config`
 * signs in again.
 */
export class LinkedInAuthError extends Error {
  override readonly name = "LinkedInAuthError";
}

/** Invalid configuration or input the SDK refuses before sending anything. */
export class LinkedInConfigError extends Error {
  override readonly name = "LinkedInConfigError";
}

/** The request exceeded `timeoutMs`. */
export class LinkedInTimeoutError extends Error {
  override readonly name = "LinkedInTimeoutError";
  constructor(
    readonly method: string,
    readonly path: string,
    readonly timeoutMs: number
  ) {
    super(`${method} ${path}: no response within ${timeoutMs}ms`);
  }
}

/** An uploaded media asset that LinkedIn could not process, or that did not finish processing in time. */
export class LinkedInMediaError extends Error {
  override readonly name = "LinkedInMediaError";
}

function field<T>(body: unknown, key: string, type: "string" | "number"): T | undefined {
  if (!body || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === type ? (value as T) : undefined;
}

/** Builds the error from the body of a non-2xx response: Rest.li's, OAuth's, or plain text. */
export function apiErrorFromBody(
  base: { status: number; method: string; path: string },
  body: unknown,
  secrets: readonly string[]
): LinkedInApiError {
  let message =
    field<string>(body, "message", "string") ??
    field<string>(body, "error_description", "string") ??
    field<string>(body, "error", "string");
  if (message === undefined && typeof body === "string" && body.trim()) message = body.trim().slice(0, 500);
  return new LinkedInApiError({
    ...base,
    message: redact(message ?? `HTTP ${base.status}`, secrets) as string,
    serviceErrorCode: field<number>(body, "serviceErrorCode", "number"),
    code: field<string>(body, "code", "string"),
    body: redact(body, secrets),
  });
}
