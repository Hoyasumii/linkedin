import { LinkedInApiError, LinkedInConfigError } from "./errors";
import * as endpoints from "./generated/endpoints";
import type { MediaAsset, PostContent, PostCreate, UserInfo, Visibility } from "./generated/model";
import { MAX_COMMENTARY_LENGTH, toLittle } from "./little";
import {
  type MediaFile,
  type MediaKind,
  type PollOptions,
  checkMedia,
  readMediaFile,
  waitUntilAvailable,
} from "./media";
import { parsePostRef, postUrl } from "./posts";
import { type AccessTokenSource, type TransportConfig, type TransportInit, uploadBytes } from "./transport";

/** LinkedIn's API host. */
export const DEFAULT_BASE_URL = "https://api.linkedin.com";
/** The `LinkedIn-Version` sent by default (`YYYYMM`); LinkedIn supports each version for about a year. */
export const DEFAULT_API_VERSION = "202609";
/** The default timeout per request; an upload part is 4 MB. */
export const DEFAULT_TIMEOUT_MS = 120_000;

export interface LinkedInClientOptions {
  /** The member's access token, or a function answering it (called on every request). */
  accessToken: AccessTokenSource;
  /**
   * The member's person URN (`urn:li:person:…`), the author of every post. When left out it is read
   * once from OpenID Connect `userinfo` (needs the `openid profile` scopes).
   */
  author?: string | (() => string | Promise<string>);
  /** `LinkedIn-Version`, `YYYYMM` (default {@link DEFAULT_API_VERSION}). */
  apiVersion?: string;
  /** Default {@link DEFAULT_BASE_URL}; another origin for tests. */
  baseUrl?: string;
  /** Timeout per request, in ms (default 120000; `0` or `Infinity` turn it off). */
  timeoutMs?: number;
  /** An alternative `fetch` (tests, proxy). */
  fetch?: typeof fetch;
  /** How long to wait for an uploaded video or document to finish processing. */
  poll?: PollOptions;
}

/** Per-call options: an `AbortSignal` to cancel the request. */
export interface CallOptions {
  signal?: AbortSignal;
}

/** A file to upload: a local path, or bytes with a file name. */
export type MediaInput = string | MediaFile;

export interface ImageInput {
  file: MediaInput;
  /** Alternative text for screen readers (recommended under 120 characters). */
  altText?: string;
}

export interface TitledMediaInput {
  file: MediaInput;
  /** Shown with the video or document; a document defaults to its file name. */
  title?: string;
}

export interface ArticleInput {
  /** The link. LinkedIn does not fetch the page, so the card shows only what is set here. */
  url: string;
  title?: string;
  description?: string;
  /** An image file for the card. */
  thumbnail?: MediaInput;
}

/** `PUBLIC` (anyone) or `CONNECTIONS` (1st-degree connections only). */
export type PostVisibility = Extract<Visibility, "PUBLIC" | "CONNECTIONS">;

export interface TextOptions {
  /**
   * The text is already in LinkedIn's "little" format (for `@[Name](urn:li:person:…)` mentions):
   * sent as is. By default the text is plain and every reserved character is escaped.
   */
  rawText?: boolean;
  /** With plain text: keep `#word` as hashtags (default `true`). */
  hashtags?: boolean;
}

export interface CreatePostParams extends TextOptions {
  /** The post's text (up to 3000 characters once escaped). */
  text: string;
  /** Default `PUBLIC`. */
  visibility?: PostVisibility;
  /** One image, or 2 to 20 for a multi-image post. */
  images?: (MediaInput | ImageInput)[];
  video?: MediaInput | TitledMediaInput;
  document?: MediaInput | TitledMediaInput;
  article?: ArticleInput;
  /** Reshare this post (URN or URL), with `text` as the commentary. */
  reshareOf?: string;
  /** Stop others from resharing it. */
  disableReshare?: boolean;
}

export interface CreatedPost {
  urn: string;
  url: string;
  author: string;
}

export interface EditPostParams extends TextOptions {
  /** The new text. The post's media cannot be changed. */
  text: string;
}

export interface LinkedInClient {
  /** The signed-in member, from OpenID Connect `userinfo`. */
  me(options?: CallOptions): Promise<UserInfo>;
  /** The person URN posts are made as. */
  author(options?: CallOptions): Promise<string>;
  /** Publishes a post: text, optionally with images, a video, a document, an article link or a reshare. */
  createPost(params: CreatePostParams, options?: CallOptions): Promise<CreatedPost>;
  /** Replaces a post's text; `post` is a URN or a URL holding one. Answers the URN. */
  editPost(post: string, params: EditPostParams, options?: CallOptions): Promise<string>;
  /** Deletes a post (idempotent); `post` is a URN or a URL holding one. Answers the URN. */
  deletePost(post: string, options?: CallOptions): Promise<string>;
  /** Uploads an image; answers its `urn:li:image:` URN. */
  uploadImage(file: MediaInput, options?: CallOptions): Promise<string>;
  /** Uploads a video in 4 MB parts and waits until LinkedIn has processed it; answers its URN. */
  uploadVideo(file: MediaInput, options?: CallOptions): Promise<string>;
  /** Uploads a document and waits until LinkedIn has processed it; answers its URN. */
  uploadDocument(file: MediaInput, options?: CallOptions): Promise<string>;
}

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw new LinkedInConfigError(`invalid baseUrl: ${value}`);
  }
  return value.replace(/\/+$/, "");
}

/** `true` when an error says a media asset is not processed yet (the post can be retried). */
function mediaNotReady(error: unknown): boolean {
  return (
    error instanceof LinkedInApiError &&
    (error.status === 400 || error.status === 422) &&
    /MEDIA_ASSET_(PROCESSING|WAITING_UPLOAD)|still processing|waiting upload|not (yet )?available/i.test(
      `${error.code ?? ""} ${error.message}`
    )
  );
}

function withTitle(input: MediaInput | TitledMediaInput): TitledMediaInput {
  return typeof input === "object" && "file" in input ? input : { file: input };
}

function withAlt(input: MediaInput | ImageInput): ImageInput {
  return typeof input === "object" && "file" in input ? input : { file: input };
}

/**
 * Creates the client.
 *
 * ```ts
 * const linkedin = createLinkedInClient({ accessToken: process.env.LINKEDIN_ACCESS_TOKEN! });
 * const { url } = await linkedin.createPost({ text: "Hello from the API (with parentheses)!" });
 * ```
 */
export function createLinkedInClient(options: LinkedInClientOptions): LinkedInClient {
  if (!options?.accessToken) throw new LinkedInConfigError("accessToken is required");
  const config: TransportConfig = {
    baseUrl: normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL),
    accessToken: options.accessToken,
    apiVersion: options.apiVersion ?? DEFAULT_API_VERSION,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
  };
  const poll = options.poll ?? {};
  const sleep = poll.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const init = (call?: CallOptions, headers?: Record<string, string>): TransportInit => ({
    transport: config,
    signal: call?.signal,
    headers,
  });

  let cachedAuthor: Promise<string> | undefined;
  const author = (call?: CallOptions): Promise<string> => {
    if (typeof options.author === "string") return Promise.resolve(options.author);
    if (typeof options.author === "function") return Promise.resolve(options.author());
    cachedAuthor ??= endpoints.getUserInfo(init(call)).then((member) => `urn:li:person:${member.sub}`);
    cachedAuthor.catch(() => (cachedAuthor = undefined));
    return cachedAuthor;
  };

  const load = async (kind: MediaKind, input: MediaInput): Promise<MediaFile> => {
    if (typeof input === "string") return readMediaFile(kind, input);
    checkMedia(kind, input.filename, input.data.byteLength);
    return input;
  };

  /**
   * Waits for a video or document to be AVAILABLE. A token with only `w_member_social` may be
   * refused the status read (403); the post is then retried until the asset is ready instead.
   */
  const awaitAsset = async (urn: string, get: () => Promise<MediaAsset>): Promise<void> => {
    try {
      await waitUntilAvailable(urn, get, poll);
    } catch (error) {
      if (error instanceof LinkedInApiError && error.status === 403) return;
      throw error;
    }
  };

  const uploadImage = async (input: MediaInput, call?: CallOptions): Promise<string> => {
    const file = await load("image", input);
    const owner = await author(call);
    const { value } = await endpoints.initializeImageUpload({ initializeUploadRequest: { owner } }, init(call));
    await uploadBytes(value.uploadUrl, file.data, config, { contentType: file.contentType, signal: call?.signal });
    return value.image;
  };

  const uploadDocument = async (input: MediaInput, call?: CallOptions): Promise<string> => {
    const file = await load("document", input);
    const owner = await author(call);
    const { value } = await endpoints.initializeDocumentUpload({ initializeUploadRequest: { owner } }, init(call));
    await uploadBytes(value.uploadUrl, file.data, config, { contentType: file.contentType, signal: call?.signal });
    await awaitAsset(value.document, () => endpoints.getDocument(encodeURIComponent(value.document), init(call)));
    return value.document;
  };

  const uploadVideo = async (input: MediaInput, call?: CallOptions): Promise<string> => {
    const file = await load("video", input);
    const owner = await author(call);
    const { value } = await endpoints.initializeVideoUpload(
      {
        initializeUploadRequest: {
          owner,
          fileSizeBytes: file.data.byteLength,
          uploadCaptions: false,
          uploadThumbnail: false,
        },
      },
      init(call)
    );
    const partIds: string[] = [];
    for (const part of value.uploadInstructions) {
      const bytes = file.data.subarray(part.firstByte, part.lastByte + 1);
      const etag = await uploadBytes(part.uploadUrl, bytes, config, {
        contentType: "application/octet-stream",
        signal: call?.signal,
      });
      if (!etag)
        throw new LinkedInConfigError(`LinkedIn answered no ETag for bytes ${part.firstByte}-${part.lastByte}`);
      partIds.push(etag);
    }
    await endpoints.finalizeVideoUpload(
      { finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken ?? "", uploadedPartIds: partIds } },
      init(call)
    );
    await awaitAsset(value.video, () => endpoints.getVideo(encodeURIComponent(value.video), init(call)));
    return value.video;
  };

  const commentary = (text: string, textOptions: TextOptions): string => {
    const little = textOptions.rawText ? text : toLittle(text, { hashtags: textOptions.hashtags });
    if (little.length > MAX_COMMENTARY_LENGTH) {
      throw new LinkedInConfigError(
        `the text is ${little.length} characters once escaped; LinkedIn accepts up to ${MAX_COMMENTARY_LENGTH}`
      );
    }
    return little;
  };

  const contentOf = async (params: CreatePostParams, call?: CallOptions): Promise<PostContent | undefined> => {
    const kinds = [
      params.images?.length ? "images" : "",
      params.video ? "video" : "",
      params.document ? "document" : "",
      params.article ? "article" : "",
    ].filter(Boolean);
    if (kinds.length > 1) {
      throw new LinkedInConfigError(`a post carries one kind of media; got ${kinds.join(" and ")}`);
    }
    if (kinds.length > 0 && params.reshareOf) {
      throw new LinkedInConfigError("a reshare carries no media of its own");
    }
    if (params.images?.length) {
      if (params.images.length > 20) throw new LinkedInConfigError("a post holds at most 20 images");
      const images = params.images.map(withAlt);
      const uploaded = [];
      for (const image of images) {
        const id = await uploadImage(image.file, call);
        uploaded.push(image.altText ? { id, altText: image.altText } : { id });
      }
      return uploaded.length === 1 ? { media: uploaded[0] } : { multiImage: { images: uploaded } };
    }
    if (params.video) {
      const video = withTitle(params.video);
      const id = await uploadVideo(video.file, call);
      return { media: video.title ? { id, title: video.title } : { id } };
    }
    if (params.document) {
      const document = withTitle(params.document);
      const id = await uploadDocument(document.file, call);
      const title =
        document.title ??
        (typeof document.file === "string" ? document.file.split(/[\\/]/).pop() : document.file.filename);
      return { media: { id, title } };
    }
    if (params.article) {
      const { url, title, description, thumbnail } = params.article;
      try {
        new URL(url);
      } catch {
        throw new LinkedInConfigError(`article url is not a URL: ${url}`);
      }
      return {
        article: {
          source: url,
          ...(title ? { title } : {}),
          ...(description ? { description } : {}),
          ...(thumbnail ? { thumbnail: await uploadImage(thumbnail, call) } : {}),
        },
      };
    }
    return undefined;
  };

  const createPost = async (params: CreatePostParams, call?: CallOptions): Promise<CreatedPost> => {
    const text = commentary(params.text ?? "", params);
    const visibility = params.visibility ?? "PUBLIC";
    if (visibility !== "PUBLIC" && visibility !== "CONNECTIONS") {
      throw new LinkedInConfigError(`visibility must be PUBLIC or CONNECTIONS (got '${String(visibility)}')`);
    }
    const reshareOf = params.reshareOf ? parsePostRef(params.reshareOf) : undefined;
    const owner = await author(call);
    const content = await contentOf(params, call);
    const body: PostCreate = {
      author: owner,
      commentary: text,
      visibility,
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: params.disableReshare ?? false,
      ...(content ? { content } : {}),
      ...(reshareOf ? { reshareContext: { parent: reshareOf } } : {}),
    };
    const deadline = (poll.now ?? Date.now)() + (poll.timeoutMs ?? 10 * 60_000);
    for (;;) {
      try {
        const { id } = await endpoints.createPost(body, init(call));
        return { urn: id, url: postUrl(id), author: owner };
      } catch (error) {
        if (!content || !mediaNotReady(error) || (poll.now ?? Date.now)() >= deadline) throw error;
        await sleep(poll.intervalMs ?? 2_000);
      }
    }
  };

  return {
    me: (call) => endpoints.getUserInfo(init(call)),
    author,
    createPost,
    async editPost(post, params, call) {
      const urn = parsePostRef(post);
      await endpoints.updatePost(
        encodeURIComponent(urn),
        { patch: { $set: { commentary: commentary(params.text ?? "", params) } } },
        init(call, { "X-RestLi-Method": "PARTIAL_UPDATE" })
      );
      return urn;
    },
    async deletePost(post, call) {
      const urn = parsePostRef(post);
      await endpoints.deletePost(encodeURIComponent(urn), init(call, { "X-RestLi-Method": "DELETE" }));
      return urn;
    },
    uploadImage,
    uploadVideo,
    uploadDocument,
  };
}
