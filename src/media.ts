import * as fs from "node:fs/promises";
import * as path from "node:path";
import { LinkedInConfigError, LinkedInMediaError } from "./errors";

/** What each kind of media accepts, from LinkedIn's Images, Videos and Documents API pages. */
export const MEDIA_RULES = {
  image: {
    extensions: { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif" },
    // LinkedIn limits images by pixels (36,152,320), not bytes; this only stops an obvious mistake.
    maxBytes: 100 * 1024 * 1024,
  },
  video: {
    extensions: { ".mp4": "video/mp4" },
    minBytes: 75 * 1024,
    maxBytes: 500 * 1024 * 1024,
  },
  document: {
    extensions: {
      ".pdf": "application/pdf",
      ".ppt": "application/vnd.ms-powerpoint",
      ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".doc": "application/msword",
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    maxBytes: 100 * 1024 * 1024,
  },
} as const;

export type MediaKind = keyof typeof MEDIA_RULES;

/** A file to upload: its bytes, the name LinkedIn shows for a document, and its media type. */
export interface MediaFile {
  data: Uint8Array;
  filename: string;
  contentType: string;
}

function mebibytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/** Checks a file's extension and size against what LinkedIn accepts for `kind`; answers its media type. */
export function checkMedia(kind: MediaKind, filename: string, size: number): string {
  const rules = MEDIA_RULES[kind];
  const ext = path.extname(filename).toLowerCase();
  const contentType = (rules.extensions as Record<string, string>)[ext];
  if (!contentType) {
    throw new LinkedInConfigError(
      `${filename}: a ${kind} must be ${Object.keys(rules.extensions).join(", ")} (got '${ext || "no extension"}')`
    );
  }
  if (size === 0) throw new LinkedInConfigError(`${filename} is empty`);
  if ("minBytes" in rules && size < rules.minBytes) {
    throw new LinkedInConfigError(`${filename}: a ${kind} must be at least ${rules.minBytes / 1024} KB`);
  }
  if (size > rules.maxBytes) {
    throw new LinkedInConfigError(
      `${filename}: a ${kind} must be at most ${mebibytes(rules.maxBytes)} (it is ${mebibytes(size)})`
    );
  }
  return contentType;
}

/** Reads a local file for upload, checked by {@link checkMedia}. */
export async function readMediaFile(kind: MediaKind, file: string): Promise<MediaFile> {
  const resolved = path.resolve(file);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    throw new LinkedInConfigError(`${resolved} does not exist`);
  }
  if (!stat.isFile()) throw new LinkedInConfigError(`${resolved} is not a file`);
  const filename = path.basename(resolved);
  const contentType = checkMedia(kind, filename, stat.size);
  return { data: new Uint8Array(await fs.readFile(resolved)), filename, contentType };
}

/** How long {@link waitUntilAvailable} polls, and how often. */
export interface PollOptions {
  /** Default 10 minutes: a long video takes a while. */
  timeoutMs?: number;
  /** Default 2 s. */
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls `status` until the asset is AVAILABLE. PROCESSING_FAILED throws with LinkedIn's reason;
 * running out of time throws too, naming the asset so it can be checked later.
 */
export async function waitUntilAvailable(
  urn: string,
  status: () => Promise<{ status?: string; processingFailureReason?: string }>,
  options: PollOptions = {}
): Promise<void> {
  const { timeoutMs = 10 * 60_000, intervalMs = 2_000, sleep = defaultSleep, now = Date.now } = options;
  const deadline = now() + timeoutMs;
  for (;;) {
    const asset = await status();
    if (asset.status === "AVAILABLE") return;
    if (asset.status === "PROCESSING_FAILED") {
      throw new LinkedInMediaError(
        `LinkedIn could not process ${urn}${asset.processingFailureReason ? `: ${asset.processingFailureReason}` : ""}`
      );
    }
    if (now() >= deadline) {
      throw new LinkedInMediaError(
        `${urn} was still ${asset.status ?? "processing"} after ${Math.round(timeoutMs / 1000)}s`
      );
    }
    await sleep(intervalMs);
  }
}
