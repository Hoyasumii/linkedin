import { IncomingMessage, Server, ServerResponse, createServer } from "node:http";
import { AddressInfo } from "node:net";

export interface Seen {
  method: string;
  path: string;
  search: string;
  headers: Record<string, string | undefined>;
  body: Buffer;
}

export interface FakePost {
  urn: string;
  body: Record<string, unknown>;
  commentary: string;
  deleted?: boolean;
}

export const CLIENT_ID = "client-abc";
export const CLIENT_SECRET = "secret-0123456789";
export const GOOD_CODE = "code-0123456789";
export const MEMBER = { sub: "Ab12Cd34", name: "Ada Lovelace", given_name: "Ada", family_name: "Lovelace" };
export const PERSON_URN = `urn:li:person:${MEMBER.sub}`;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/**
 * A local LinkedIn on `node:http`: OAuth's token endpoint, `userinfo`, the Posts API and the
 * Images, Documents and Videos uploads, with just enough state to check what the SDK sends.
 */
export class FakeLinkedIn {
  readonly seen: Seen[] = [];
  readonly posts = new Map<string, FakePost>();
  readonly uploads = new Map<string, Buffer>();
  /** Tokens `Authorization: Bearer` may carry. */
  readonly tokens = new Set<string>(["token-0123456789"]);
  /** Statuses `GET /rest/{documents,videos}/…` answers in turn (then AVAILABLE). */
  mediaStatuses: string[] = [];
  /** Answer 403 to media status reads, as a token with only `w_member_social` may get. */
  mediaReadForbidden = false;
  /** How many creates answer "media still processing" before one succeeds. */
  createsBeforeMediaReady = 0;
  /** The bytes per video part (LinkedIn's is 4 MiB). */
  videoPartSize = 50_000;
  /** What the token endpoint answers as `scope`. */
  grantedScope = "openid,profile,w_member_social";
  /** A refresh token the token endpoint hands out (none by default, as for most apps). */
  refreshToken: string | undefined;
  #next = 7000000000000000000n;
  #server: Server;

  private constructor() {
    this.#server = createServer((req, res) => {
      void this.handle(req, res).catch((error: unknown) => {
        res.writeHead(500).end(String(error));
      });
    });
  }

  static async start(): Promise<FakeLinkedIn> {
    const fake = new FakeLinkedIn();
    await new Promise<void>((resolve) => fake.#server.listen(0, "127.0.0.1", resolve));
    return fake;
  }

  get url(): string {
    return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  get tokenUrl(): string {
    return `${this.url}/oauth/v2/accessToken`;
  }

  /** The requests to `path` (without the query string). */
  hits(path: string): Seen[] {
    return this.seen.filter((s) => s.path === path);
  }

  /** The last JSON body sent to `path`. */
  lastJson(path: string): Record<string, unknown> {
    const hit = [...this.seen].reverse().find((s) => s.path === path);
    if (!hit) throw new Error(`no request to ${path}`);
    return JSON.parse(hit.body.toString("utf8")) as Record<string, unknown>;
  }

  stop(): Promise<void> {
    this.#server.closeAllConnections();
    return new Promise((resolve) => this.#server.close(() => resolve()));
  }

  private id(): string {
    this.#next += 1n;
    return String(this.#next);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.url);
    const body = await readBody(req);
    const headers: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.headers))
      headers[key] = Array.isArray(value) ? value.join(",") : value;
    this.seen.push({ method: req.method ?? "GET", path: url.pathname, search: url.search, headers, body });

    const json = (status: number, value: unknown, extra: Record<string, string> = {}): void => {
      res.writeHead(status, { "Content-Type": "application/json", ...extra }).end(JSON.stringify(value));
    };
    const empty = (status: number, extra: Record<string, string> = {}): void => {
      res.writeHead(status, extra).end();
    };
    const restError = (status: number, code: string, message: string): void =>
      json(status, { status, code, serviceErrorCode: 100, message });

    if (url.pathname === "/oauth/v2/accessToken") {
      const form = new URLSearchParams(body.toString("utf8"));
      if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) {
        return json(401, { error: "invalid_client", error_description: "Client authentication failed" });
      }
      const grant = form.get("grant_type");
      const ok =
        (grant === "authorization_code" && form.get("code") === GOOD_CODE && !!form.get("redirect_uri")) ||
        (grant === "refresh_token" && !!this.refreshToken && form.get("refresh_token") === this.refreshToken);
      if (!ok) return json(400, { error: "invalid_request", error_description: "Unable to retrieve access token" });
      const token = `token-${this.id()}`;
      this.tokens.add(token);
      return json(200, {
        access_token: token,
        expires_in: 5184000,
        scope: this.grantedScope,
        ...(this.refreshToken ? { refresh_token: this.refreshToken, refresh_token_expires_in: 31536000 } : {}),
      });
    }

    if (url.pathname.startsWith("/upload/")) {
      if (req.method !== "PUT") return empty(405);
      this.uploads.set(url.pathname, body);
      return empty(201, { ETag: `"etag-${url.pathname.split("/").pop()}"` });
    }

    const auth = headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || !this.tokens.has(auth.slice(7))) {
      return json(401, {
        status: 401,
        serviceErrorCode: 65600,
        code: "INVALID_ACCESS_TOKEN",
        message: "Invalid access token",
      });
    }

    if (url.pathname === "/v2/userinfo") return json(200, MEMBER);

    if (url.pathname.startsWith("/rest/")) {
      if (!/^20\d{4}$/.test(headers["linkedin-version"] ?? "") || headers["x-restli-protocol-version"] !== "2.0.0") {
        return restError(
          400,
          "VERSION_MISSING",
          "A version must be present. Please specify a version by adding the LinkedIn-Version header."
        );
      }
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const action = url.searchParams.get("action");

    if (url.pathname === "/rest/posts" && req.method === "POST") {
      const post = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
      if (post.author !== PERSON_URN)
        return restError(403, "ACCESS_DENIED", "Not enough permissions to post as this author");
      const content = post.content as Record<string, unknown> | undefined;
      if (content && this.createsBeforeMediaReady > 0) {
        this.createsBeforeMediaReady -= 1;
        return restError(400, "MEDIA_ASSET_PROCESSING", "Media asset is still processing");
      }
      const urn = `urn:li:share:${this.id()}`;
      this.posts.set(urn, { urn, body: post, commentary: String(post.commentary) });
      return empty(201, { "x-restli-id": encodeURIComponent(urn) });
    }

    if (parts[0] === "rest" && parts[1] === "posts" && parts.length === 3) {
      const urn = decodeURIComponent(parts[2]);
      const post = this.posts.get(urn);
      if (!post || post.deleted) {
        if (req.method === "DELETE" && post?.deleted) return empty(204);
        return restError(404, "NOT_FOUND", "Not Found");
      }
      if (req.method === "DELETE") {
        if (headers["x-restli-method"] !== "DELETE") return restError(400, "BAD_METHOD", "missing X-RestLi-Method");
        post.deleted = true;
        return empty(204);
      }
      if (req.method === "POST") {
        if (headers["x-restli-method"] !== "PARTIAL_UPDATE")
          return restError(400, "BAD_METHOD", "missing X-RestLi-Method");
        const patch = JSON.parse(body.toString("utf8")) as { patch?: { $set?: { commentary?: string } } };
        if (patch.patch?.$set?.commentary !== undefined) post.commentary = patch.patch.$set.commentary;
        return empty(204);
      }
    }

    if ((url.pathname === "/rest/images" || url.pathname === "/rest/documents") && action === "initializeUpload") {
      const kind = url.pathname === "/rest/images" ? "image" : "document";
      const request = JSON.parse(body.toString("utf8")) as { initializeUploadRequest?: { owner?: string } };
      if (request.initializeUploadRequest?.owner !== PERSON_URN)
        return restError(403, "ACCESS_DENIED", "owner mismatch");
      const id = this.id();
      return json(200, {
        value: {
          uploadUrl: `${this.url}/upload/${kind}/${id}`,
          uploadUrlExpiresAt: Date.now() + 3600_000,
          [kind]: `urn:li:${kind}:D${id}`,
        },
      });
    }

    if (url.pathname === "/rest/videos" && action === "initializeUpload") {
      const request = JSON.parse(body.toString("utf8")) as {
        initializeUploadRequest: { owner: string; fileSizeBytes: number };
      };
      const id = this.id();
      const size = request.initializeUploadRequest.fileSizeBytes;
      const uploadInstructions = [];
      for (let first = 0, part = 0; first < size; first += this.videoPartSize, part++) {
        uploadInstructions.push({
          uploadUrl: `${this.url}/upload/video/${id}-${part}`,
          firstByte: first,
          lastByte: Math.min(first + this.videoPartSize, size) - 1,
        });
      }
      return json(200, {
        value: { video: `urn:li:video:V${id}`, uploadInstructions, uploadToken: "", uploadUrlsExpireAt: 0 },
      });
    }

    if (url.pathname === "/rest/videos" && action === "finalizeUpload") {
      const request = JSON.parse(body.toString("utf8")) as {
        finalizeUploadRequest: { video: string; uploadedPartIds: string[] };
      };
      const id = request.finalizeUploadRequest.video.replace("urn:li:video:V", "");
      const expected = [...this.uploads.keys()]
        .filter((key) => key.startsWith(`/upload/video/${id}-`))
        .map((key) => `etag-${key.split("/").pop()}`);
      if (JSON.stringify(expected) !== JSON.stringify(request.finalizeUploadRequest.uploadedPartIds)) {
        return restError(400, "INVALID_PART_IDS", "uploadedPartIds do not match the uploaded parts");
      }
      return empty(200);
    }

    if ((parts[1] === "documents" || parts[1] === "videos") && parts.length === 3 && req.method === "GET") {
      if (this.mediaReadForbidden) return restError(403, "ACCESS_DENIED", "Not enough permissions to access media");
      return json(200, { id: decodeURIComponent(parts[2]), status: this.mediaStatuses.shift() ?? "AVAILABLE" });
    }

    return restError(404, "NOT_FOUND", `No route for ${req.method} ${url.pathname}`);
  }
}
