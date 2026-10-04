import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { daysLeft, readCredentials } from "../../auth/credentials";
import type { CreatePostParams } from "../../client";
import { MAX_COMMENTARY_LENGTH } from "../../little";
import { parsePostRef } from "../../posts";
import type { PostMediaSummary, PostRecord } from "../../registry";
import { ToolInputError } from "../errors";
import { LOCAL_READ, OVERWRITE, PUBLISH, READ, type ToolContext, run } from "./shared";

const text = z
  .string()
  .min(1)
  .describe(
    `The post's text, as plain text: line breaks are kept, #words become hashtags, and LinkedIn's reserved ` +
      `characters are escaped for you. Up to ${MAX_COMMENTARY_LENGTH} characters.`
  );
const rawText = z
  .boolean()
  .optional()
  .describe(
    "The text is already in LinkedIn's 'little' format and is sent as is (for mentions: @[Name](urn:li:person:…)). " +
      "Every reserved character (\\ | { } @ [ ] ( ) < > # * _ ~) not part of a mention or hashtag must then be escaped with \\."
  );
const hashtags = z
  .boolean()
  .optional()
  .describe("Keep #words as hashtags (default true); false makes every # plain text.");
const post = z
  .string()
  .min(1)
  .describe(
    "The post: its URN (urn:li:share:… or urn:li:ugcPost:…) or a LinkedIn URL holding one, such as " +
      "https://www.linkedin.com/feed/update/urn:li:share:…/ (linkedin_list_posts has the URNs of posts made here)."
  );

const localFile = z.string().min(1).describe("A local file path.");

/** The media summary the registry keeps for a new post. */
function mediaSummary(
  params: CreatePostParams,
  files: { images?: string[]; video?: string; document?: string }
): PostMediaSummary | undefined {
  if (files.images?.length) return { kind: files.images.length === 1 ? "image" : "images", files: files.images };
  if (files.video)
    return { kind: "video", files: [files.video], ...(titleOf(params.video) ? { title: titleOf(params.video) } : {}) };
  if (files.document) {
    return {
      kind: "document",
      files: [files.document],
      ...(titleOf(params.document) ? { title: titleOf(params.document) } : {}),
    };
  }
  if (params.article) {
    return {
      kind: "article",
      url: params.article.url,
      ...(params.article.title ? { title: params.article.title } : {}),
    };
  }
  return undefined;
}

function titleOf(input: CreatePostParams["video"]): string | undefined {
  return typeof input === "object" && "title" in input ? input.title : undefined;
}

/** What the tools answer about a post: the record, minus what only the registry needs. */
function shown(record: PostRecord): Record<string, unknown> {
  const { createdHere, ...rest } = record;
  return createdHere ? rest : { ...rest, note: "Created outside this MCP server: only its edits made here are known." };
}

/** Create, edit and delete the member's posts; list and show the ones made here. */
export function registerPostTools(server: McpServer, context: ToolContext): void {
  const { client, registry, credentialsFile } = context.connection;

  server.registerTool(
    "linkedin_whoami",
    {
      title: "Who is signed in",
      description:
        "The LinkedIn member the server posts as (name and person URN) and when the sign-in expires. Use it to " +
        "check the connection before posting.",
      inputSchema: {},
      annotations: READ,
    },
    async () =>
      run(async () => {
        const saved = credentialsFile ? readCredentials(credentialsFile) : undefined;
        if (saved) {
          return {
            name: saved.name,
            personUrn: saved.personUrn,
            expiresAt: saved.expiresAt,
            daysLeft: daysLeft(saved),
            scopes: saved.scopes,
            renew: "Run `linkedin mcp config --web` to sign in again before it expires.",
          };
        }
        const member = await client.me();
        return { name: member.name, personUrn: `urn:li:person:${member.sub}`, token: "LINKEDIN_ACCESS_TOKEN" };
      })
  );

  server.registerTool(
    "linkedin_create_post",
    {
      title: "Publish a post",
      description:
        "Publish a post on the signed-in member's LinkedIn profile, right away. Optionally with ONE kind of media: " +
        "images (1, or 2 to 20 for a gallery: JPG, PNG or GIF), a video (MP4, 75 KB to 500 MB, 3 s to 30 min), a " +
        "document shown as a carousel (PDF, PPT, PPTX, DOC or DOCX, up to 100 MB and 300 pages), or an article " +
        "link card. Or reshare another post. Publish only what the user asked for; when you wrote the text, show " +
        "it to them first. Answers the post's URN and URL; the post is also saved to the local list.",
      inputSchema: {
        text,
        visibility: z
          .enum(["PUBLIC", "CONNECTIONS"])
          .optional()
          .describe("PUBLIC (anyone, the default) or CONNECTIONS (1st-degree connections only)."),
        images: z
          .array(
            z.object({
              path: localFile,
              alt_text: z.string().max(4086).optional().describe("Alternative text for screen readers."),
            })
          )
          .min(1)
          .max(20)
          .optional()
          .describe("Images to attach, in order."),
        video: z
          .object({ path: localFile, title: z.string().optional().describe("The video's title.") })
          .optional()
          .describe("A video to attach. Uploading and processing can take minutes."),
        document: z
          .object({
            path: localFile,
            title: z.string().optional().describe("Shown above the document (default: its file name)."),
          })
          .optional()
          .describe("A document to attach, shown as a swipeable carousel."),
        article: z
          .object({
            url: z.string().url().describe("The link."),
            title: z.string().optional().describe("The card's title (LinkedIn does not fetch the page)."),
            description: z.string().optional(),
            thumbnail: localFile.optional().describe("A local image for the card."),
          })
          .optional()
          .describe("A link card. A URL in the text alone also gets a preview on LinkedIn."),
        reshare_of: z.string().optional().describe("Reshare this post (URN or URL), with `text` as your commentary."),
        disable_reshare: z.boolean().optional().describe("Stop others from resharing this post."),
        raw_text: rawText,
        hashtags,
      },
      annotations: PUBLISH,
    },
    async (input) =>
      run(async () => {
        const params: CreatePostParams = {
          text: input.text,
          visibility: input.visibility,
          rawText: input.raw_text,
          hashtags: input.hashtags,
          disableReshare: input.disable_reshare,
          reshareOf: input.reshare_of,
          ...(input.images
            ? { images: input.images.map((image) => ({ file: image.path, altText: image.alt_text })) }
            : {}),
          ...(input.video ? { video: { file: input.video.path, title: input.video.title } } : {}),
          ...(input.document ? { document: { file: input.document.path, title: input.document.title } } : {}),
          ...(input.article
            ? {
                article: {
                  url: input.article.url,
                  title: input.article.title,
                  description: input.article.description,
                  thumbnail: input.article.thumbnail,
                },
              }
            : {}),
        };
        const created = await client.createPost(params);
        const media = mediaSummary(params, {
          images: input.images?.map((image) => image.path),
          video: input.video?.path,
          document: input.document?.path,
        });
        const record = registry.added({
          urn: created.urn,
          author: created.author,
          text: input.text,
          visibility: input.visibility ?? "PUBLIC",
          ...(media ? { media } : {}),
          ...(input.reshare_of ? { reshareOf: parsePostRef(input.reshare_of) } : {}),
        });
        return shown(record);
      })
  );

  server.registerTool(
    "linkedin_edit_post",
    {
      title: "Edit a post's text",
      description:
        "Replace the text of one of the member's posts (it shows as edited). Only the text can change: images, " +
        "video, documents and links cannot be swapped — delete and post again for that. LinkedIn does not let this " +
        "server read a post, so take the current text from linkedin_get_post (posts made here) or from the user.",
      inputSchema: { post, text, raw_text: rawText, hashtags },
      annotations: OVERWRITE,
    },
    async (input) =>
      run(async () => {
        const urn = await client.editPost(input.post, {
          text: input.text,
          rawText: input.raw_text,
          hashtags: input.hashtags,
        });
        return shown(registry.edited(urn, { text: input.text, author: await client.author() }));
      })
  );

  server.registerTool(
    "linkedin_delete_post",
    {
      title: "Delete a post",
      description:
        "Delete one of the member's posts from LinkedIn, permanently, with its comments and reactions. Only when " +
        "the user asked for this post to be deleted: confirm the post with them (linkedin_get_post shows posts made " +
        "here), then call with confirm: true.",
      inputSchema: {
        post,
        confirm: z.boolean().describe("Must be true: the user agreed to delete this post. It cannot be undone."),
      },
      annotations: OVERWRITE,
    },
    async (input) =>
      run(async () => {
        if (input.confirm !== true) {
          throw new ToolInputError(
            "Deleting cannot be undone: confirm the post with the user, then call again with confirm: true."
          );
        }
        const urn = await client.deletePost(input.post);
        const record = registry.deleted(urn);
        return record ? { deleted: true, ...shown(record) } : { deleted: true, urn };
      })
  );

  server.registerTool(
    "linkedin_list_posts",
    {
      title: "List posts made here",
      description:
        "The posts created, edited or deleted through this server (saved locally), newest first. LinkedIn does not " +
        "let ordinary apps read a member's posts (the r_member_social permission is closed), so posts made on " +
        "LinkedIn itself are not listed: to edit or delete one, ask the user for its URN or URL.",
      inputSchema: {
        query: z.string().optional().describe("Only posts whose text contains this (case-insensitive)."),
        limit: z.number().int().min(1).max(100).optional().describe("How many (default 20)."),
        include_deleted: z.boolean().optional().describe("Include deleted posts (default false)."),
      },
      annotations: LOCAL_READ,
    },
    async (input) =>
      run(async () => {
        const posts = registry.list({ query: input.query, limit: input.limit, includeDeleted: input.include_deleted });
        return { count: posts.length, posts: posts.map(shown) };
      })
  );

  server.registerTool(
    "linkedin_get_post",
    {
      title: "Show a post made here",
      description:
        "One post from the local list of posts made through this server: its text as last written here, " +
        "visibility, media and dates. Posts made on LinkedIn itself are not known.",
      inputSchema: { post },
      annotations: LOCAL_READ,
    },
    async (input) =>
      run(async () => {
        const urn = parsePostRef(input.post);
        const record = registry.get(urn);
        if (!record) {
          throw new ToolInputError(
            `${urn} was not made or edited through this server, and LinkedIn does not let it read posts. Ask the user for its text.`
          );
        }
        return shown(record);
      })
  );
}
