import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  LinkedInApiError,
  LinkedInAuthError,
  LinkedInConfigError,
  LinkedInMediaError,
  createLinkedInClient,
  parsePostRef,
} from "../../src";
import { sendsTokenTo } from "../../src/transport";
import { FakeLinkedIn, PERSON_URN } from "./fake-server";

const TOKEN = "token-0123456789";
let linkedin: FakeLinkedIn;
let dir: string;

beforeEach(async () => {
  linkedin = await FakeLinkedIn.start();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-client-"));
});
afterEach(async () => {
  await linkedin.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const noWait = { sleep: async () => undefined, intervalMs: 1, timeoutMs: 60_000 };

function client(options: Partial<Parameters<typeof createLinkedInClient>[0]> = {}) {
  return createLinkedInClient({ accessToken: TOKEN, baseUrl: linkedin.url, poll: noWait, ...options });
}

function file(name: string, bytes: number): string {
  const target = path.join(dir, name);
  fs.writeFileSync(target, Buffer.alloc(bytes, 7));
  return target;
}

describe("createPost", () => {
  it("posts plain text as little, with LinkedIn's headers, and answers the URN from x-restli-id", async () => {
    const created = await client().createPost({ text: "Launch (beta) — see [notes] #release @team" });
    expect(created.urn).toMatch(/^urn:li:share:\d+$/);
    expect(created.url).toBe(`https://www.linkedin.com/feed/update/${created.urn}/`);
    expect(created.author).toBe(PERSON_URN);

    const sent = linkedin.lastJson("/rest/posts");
    expect(sent).toEqual({
      author: PERSON_URN,
      commentary: "Launch \\(beta\\) — see \\[notes\\] #release \\@team",
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    });
    const hit = linkedin.hits("/rest/posts")[0];
    expect(hit.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(hit.headers["linkedin-version"]).toBe("202609");
    expect(hit.headers["x-restli-protocol-version"]).toBe("2.0.0");
    // The author came from userinfo, once.
    expect(linkedin.hits("/v2/userinfo")).toHaveLength(1);
  });

  it("sends raw little text as is, and CONNECTIONS visibility", async () => {
    await client().createPost({ text: "Hi @[Ada](urn:li:person:1)", rawText: true, visibility: "CONNECTIONS" });
    expect(linkedin.lastJson("/rest/posts")).toMatchObject({
      commentary: "Hi @[Ada](urn:li:person:1)",
      visibility: "CONNECTIONS",
    });
  });

  it("uses a given author without calling userinfo", async () => {
    await client({ author: PERSON_URN }).createPost({ text: "hello" });
    expect(linkedin.hits("/v2/userinfo")).toHaveLength(0);
  });

  it("refuses text over 3000 characters once escaped, before sending", async () => {
    await expect(client().createPost({ text: "(".repeat(1600) })).rejects.toThrow(/3200 characters once escaped/);
    expect(linkedin.hits("/rest/posts")).toHaveLength(0);
  });

  it("uploads one image as content.media, with alt text", async () => {
    const image = file("photo.png", 2048);
    await client().createPost({ text: "pic", images: [{ file: image, altText: "A cat" }] });
    const upload = [...linkedin.uploads.entries()].find(([key]) => key.startsWith("/upload/image/"));
    expect(upload?.[1].byteLength).toBe(2048);
    const content = linkedin.lastJson("/rest/posts").content as Record<string, unknown>;
    expect(content).toEqual({ media: { id: expect.stringMatching(/^urn:li:image:/), altText: "A cat" } });
  });

  it("uploads several images as content.multiImage, in order", async () => {
    const images = [file("a.jpg", 10), file("b.gif", 20), file("c.jpeg", 30)];
    await client().createPost({ text: "gallery", images });
    const content = linkedin.lastJson("/rest/posts").content as { multiImage: { images: { id: string }[] } };
    expect(content.multiImage.images).toHaveLength(3);
    expect(new Set(content.multiImage.images.map((image) => image.id)).size).toBe(3);
  });

  it("refuses an unsupported file before uploading anything", async () => {
    const bad = file("photo.webp", 100);
    await expect(client().createPost({ text: "x", images: [bad] })).rejects.toThrow(LinkedInConfigError);
    await expect(client().createPost({ text: "x", images: [bad] })).rejects.toThrow(/\.jpg, \.jpeg, \.png, \.gif/);
    expect(linkedin.seen.filter((hit) => hit.path.startsWith("/rest/"))).toHaveLength(0);
  });

  it("refuses two kinds of media at once", async () => {
    await expect(
      client().createPost({ text: "x", images: [file("a.png", 5)], article: { url: "https://example.com" } })
    ).rejects.toThrow(/one kind of media/);
  });

  it("uploads a video in parts, finalizes with the ETags in order, waits for it, and posts it", async () => {
    linkedin.mediaStatuses = ["PROCESSING", "PROCESSING"];
    const video = file("clip.mp4", 120_000);
    await client().createPost({ text: "video", video: { file: video, title: "Demo" } });
    const parts = [...linkedin.uploads.entries()].filter(([key]) => key.startsWith("/upload/video/"));
    expect(parts.map(([, bytes]) => bytes.byteLength)).toEqual([50_000, 50_000, 20_000]);
    const finalize = linkedin.lastJson("/rest/videos") as { finalizeUploadRequest: { uploadedPartIds: string[] } };
    expect(finalize.finalizeUploadRequest.uploadedPartIds).toHaveLength(3);
    expect(linkedin.seen.filter((hit) => hit.path.startsWith("/rest/videos/urn")).length).toBe(3);
    expect(linkedin.lastJson("/rest/posts").content).toEqual({
      media: { id: expect.stringMatching(/^urn:li:video:/), title: "Demo" },
    });
  });

  it("refuses a video under 75 KB", async () => {
    await expect(client().uploadVideo(file("tiny.mp4", 1000))).rejects.toThrow(/at least 75 KB/);
  });

  it("uploads a document titled after its file name by default", async () => {
    await client().createPost({ text: "deck", document: file("Slides 2026.pdf", 4096) });
    expect(linkedin.lastJson("/rest/posts").content).toEqual({
      media: { id: expect.stringMatching(/^urn:li:document:/), title: "Slides 2026.pdf" },
    });
  });

  it("throws when LinkedIn fails to process a document", async () => {
    linkedin.mediaStatuses = ["PROCESSING_FAILED"];
    await expect(client().uploadDocument(file("doc.pdf", 10))).rejects.toThrow(LinkedInMediaError);
  });

  it("retries the post while the media is still processing, when its status cannot be read", async () => {
    linkedin.mediaReadForbidden = true;
    linkedin.createsBeforeMediaReady = 2;
    const created = await client().createPost({ text: "deck", document: file("doc.pdf", 10) });
    expect(created.urn).toMatch(/^urn:li:share:/);
    expect(linkedin.hits("/rest/posts")).toHaveLength(3);
  });

  it("builds an article card with an uploaded thumbnail", async () => {
    await client().createPost({
      text: "read this",
      article: { url: "https://example.com/post", title: "Title", description: "Desc", thumbnail: file("t.png", 9) },
    });
    expect(linkedin.lastJson("/rest/posts").content).toEqual({
      article: {
        source: "https://example.com/post",
        title: "Title",
        description: "Desc",
        thumbnail: expect.stringMatching(/^urn:li:image:/),
      },
    });
  });

  it("reshares a post given by URL", async () => {
    await client().createPost({
      text: "worth reading",
      reshareOf: "https://www.linkedin.com/feed/update/urn:li:share:123/",
    });
    expect(linkedin.lastJson("/rest/posts").reshareContext).toEqual({ parent: "urn:li:share:123" });
  });
});

describe("editPost and deletePost", () => {
  it("replaces the commentary with a PARTIAL_UPDATE on the encoded URN", async () => {
    const { urn } = await client().createPost({ text: "first" });
    await expect(client().editPost(urn, { text: "second (edited)" })).resolves.toBe(urn);
    expect(linkedin.posts.get(urn)?.commentary).toBe("second \\(edited\\)");
    const hit = linkedin.hits(`/rest/posts/${encodeURIComponent(urn)}`)[0];
    expect(hit.method).toBe("POST");
    expect(hit.headers["x-restli-method"]).toBe("PARTIAL_UPDATE");
    expect(JSON.parse(hit.body.toString())).toEqual({ patch: { $set: { commentary: "second \\(edited\\)" } } });
  });

  it("deletes with X-RestLi-Method: DELETE, idempotently", async () => {
    const { urn, url } = await client().createPost({ text: "bye" });
    await expect(client().deletePost(url)).resolves.toBe(urn);
    expect(linkedin.posts.get(urn)?.deleted).toBe(true);
    await expect(client().deletePost(urn)).resolves.toBe(urn);
  });

  it("answers LinkedIn's 404 as a LinkedInApiError with its code", async () => {
    const error = await client()
      .editPost("urn:li:share:1", { text: "x" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LinkedInApiError);
    expect(error).toMatchObject({ status: 404, code: "NOT_FOUND", serviceErrorCode: 100 });
  });
});

describe("auth", () => {
  it("turns a 401 into LinkedInAuthError asking for a new sign-in, without the token", async () => {
    const error = await createLinkedInClient({ accessToken: "expired-token-xyz", baseUrl: linkedin.url })
      .createPost({ text: "x" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LinkedInAuthError);
    expect(String(error)).toMatch(/linkedin mcp config --web/);
    expect(String(error)).not.toContain("expired-token-xyz");
  });

  it("asks a token function on every request", async () => {
    const source = jest.fn(() => TOKEN);
    const linked = client({ accessToken: source, author: PERSON_URN });
    await linked.createPost({ text: "a" });
    await linked.createPost({ text: "b" });
    expect(source).toHaveBeenCalledTimes(2);
  });

  it("sends the token only to LinkedIn's hosts and the configured origin", () => {
    const base = "https://api.linkedin.com";
    expect(sendsTokenTo("https://www.linkedin.com/dms-uploads/x?sau=1", base)).toBe(true);
    expect(sendsTokenTo("https://api.linkedin.com/rest/posts", base)).toBe(true);
    expect(sendsTokenTo("https://evil.example/linkedin.com", base)).toBe(false);
    expect(sendsTokenTo("https://linkedin.com.evil.example/", base)).toBe(false);
    expect(sendsTokenTo("http://www.linkedin.com/x", base)).toBe(false);
  });
});

describe("parsePostRef", () => {
  it("takes URNs and URLs holding one, encoded or not", () => {
    expect(parsePostRef("urn:li:share:7123")).toBe("urn:li:share:7123");
    expect(parsePostRef(" https://www.linkedin.com/feed/update/urn:li:ugcPost:99/ ")).toBe("urn:li:ugcPost:99");
    expect(parsePostRef("https://www.linkedin.com/embed/feed/update/urn%3Ali%3Ashare%3A42")).toBe("urn:li:share:42");
  });

  it("explains how to find the post URN for an activity link", () => {
    expect(() => parsePostRef("https://www.linkedin.com/posts/ada_hello-activity-7123456789-AbCd")).toThrow(
      /Embed this post/
    );
    expect(() => parsePostRef("urn:li:activity:7123")).toThrow(/feed activity/);
    expect(() => parsePostRef("hello")).toThrow(/not a LinkedIn post URN/);
  });
});
