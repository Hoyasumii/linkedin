import * as path from "node:path";
import { readJsonFile, writeJsonFile } from "./fs-util";
import { postUrl } from "./posts";

/** What a post carries besides its text, as the registry remembers it. */
export interface PostMediaSummary {
  kind: "image" | "images" | "video" | "document" | "article";
  /** The local files uploaded (paths as given). */
  files?: string[];
  /** A video's or a document's title, an article's title. */
  title?: string;
  /** An article's URL. */
  url?: string;
}

/** A post this package created or edited. LinkedIn does not let a member token read posts back. */
export interface PostRecord {
  urn: string;
  url: string;
  author: string;
  /** The text as written (not escaped). */
  text: string;
  visibility: string;
  media?: PostMediaSummary;
  /** The post this one reshares. */
  reshareOf?: string;
  /** ISO 8601. */
  createdAt?: string;
  /** ISO 8601, set by an edit. */
  updatedAt?: string;
  /** ISO 8601, set by a delete. */
  deletedAt?: string;
  /** `false` for a post first seen when it was edited or deleted (created elsewhere). */
  createdHere: boolean;
}

interface RegistryFile {
  version: 1;
  posts: PostRecord[];
}

export interface ListOptions {
  /** Include deleted posts (default `false`). */
  includeDeleted?: boolean;
  /** Only posts whose text contains this, case-insensitively. */
  query?: string;
  /** Newest first; default 20. */
  limit?: number;
  /** Only posts by this author (the signed-in member). */
  author?: string;
}

/** `posts.json` beside the saved `.env`. */
export function registryPath(configFile: string): string {
  return path.join(path.dirname(configFile), "posts.json");
}

function isRecord(value: unknown): value is PostRecord {
  const data = value as Partial<PostRecord> | undefined;
  return typeof data === "object" && data !== null && typeof data.urn === "string" && typeof data.text === "string";
}

/**
 * The local list of posts created, edited or deleted through this package: the only way to "read"
 * a member's posts without `r_member_social`. The file is read on every call, so several processes
 * (the MCP server, a script) see each other's writes.
 */
export class PostRegistry {
  constructor(
    readonly file: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  private load(): PostRecord[] {
    const data = readJsonFile(this.file) as Partial<RegistryFile> | undefined;
    return Array.isArray(data?.posts) ? data.posts.filter(isRecord) : [];
  }

  private save(posts: PostRecord[]): void {
    const data: RegistryFile = { version: 1, posts };
    writeJsonFile(this.file, data);
  }

  /** Newest first (by the latest of created, updated and deleted). */
  list(options: ListOptions = {}): PostRecord[] {
    const query = options.query?.toLowerCase();
    const stamp = (post: PostRecord): string => post.deletedAt ?? post.updatedAt ?? post.createdAt ?? "";
    return this.load()
      .filter((post) => options.includeDeleted || !post.deletedAt)
      .filter((post) => !options.author || post.author === options.author)
      .filter((post) => !query || post.text.toLowerCase().includes(query))
      .sort((a, b) => stamp(b).localeCompare(stamp(a)))
      .slice(0, options.limit ?? 20);
  }

  get(urn: string): PostRecord | undefined {
    return this.load().find((post) => post.urn === urn);
  }

  /** Records a post just created. */
  added(post: Omit<PostRecord, "url" | "createdAt" | "createdHere">): PostRecord {
    const record: PostRecord = {
      ...post,
      url: postUrl(post.urn),
      createdAt: this.now().toISOString(),
      createdHere: true,
    };
    this.save([record, ...this.load().filter((existing) => existing.urn !== post.urn)]);
    return record;
  }

  /** Records an edit; a post not seen before is added with what is known of it. */
  edited(urn: string, change: { text: string; author: string }): PostRecord {
    const posts = this.load();
    const at = this.now().toISOString();
    const existing = posts.find((post) => post.urn === urn);
    const record: PostRecord = existing
      ? { ...existing, text: change.text, updatedAt: at }
      : {
          urn,
          url: postUrl(urn),
          author: change.author,
          text: change.text,
          visibility: "UNKNOWN",
          updatedAt: at,
          createdHere: false,
        };
    this.save([record, ...posts.filter((post) => post.urn !== urn)]);
    return record;
  }

  /** Records a delete; answers the record, or `undefined` for a post never seen here. */
  deleted(urn: string): PostRecord | undefined {
    const posts = this.load();
    const existing = posts.find((post) => post.urn === urn);
    if (!existing) return undefined;
    const record: PostRecord = { ...existing, deletedAt: this.now().toISOString() };
    this.save(posts.map((post) => (post.urn === urn ? record : post)));
    return record;
  }
}
