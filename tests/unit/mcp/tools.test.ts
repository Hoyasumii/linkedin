import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { writeCredentials } from "../../../src/auth/credentials";
import { buildLinkedInMcpServer, connectionFor, resolveMcpConfig } from "../../../src/mcp";
import { FakeLinkedIn, PERSON_URN } from "../fake-server";

let linkedin: FakeLinkedIn;
let client: Client;
let dir: string;
let configFile: string;

const noWait = { sleep: async () => undefined, intervalMs: 1 };

async function connect(env: Record<string, string> = {}): Promise<Client> {
  const config = resolveMcpConfig({ env, file: {}, configFile });
  const server = buildLinkedInMcpServer(connectionFor(config, { baseUrl: linkedin.url, poll: noWait }));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const connected = new Client({ name: "test", version: "0.0.0" });
  await connected.connect(clientSide);
  return connected;
}

function signIn(overrides: object = {}): void {
  writeCredentials(path.join(dir, "credentials.json"), {
    accessToken: "token-0123456789",
    expiresAt: "2099-01-01T00:00:00.000Z",
    scopes: ["openid", "profile", "w_member_social"],
    personUrn: PERSON_URN,
    name: "Ada Lovelace",
    savedAt: "2026-10-04T00:00:00.000Z",
    ...overrides,
  });
}

beforeEach(async () => {
  linkedin = await FakeLinkedIn.start();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-tools-"));
  configFile = path.join(dir, ".env");
  signIn();
  client = await connect();
});
afterEach(async () => {
  await client.close();
  await linkedin.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[]).map((part) => part.text).join("");
  return { text, isError: result.isError === true };
}

async function json(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await call(name, args);
  if (result.isError) throw new Error(result.text);
  return JSON.parse(result.text) as Record<string, unknown>;
}

it("lists the six tools, with honest annotations", async () => {
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  expect(Object.keys(byName).sort()).toEqual([
    "linkedin_create_post",
    "linkedin_delete_post",
    "linkedin_edit_post",
    "linkedin_get_post",
    "linkedin_list_posts",
    "linkedin_whoami",
  ]);
  expect(byName.linkedin_delete_post.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
  expect(byName.linkedin_list_posts.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  expect(client.getInstructions()).toMatch(/does not let this server read posts/);
});

it("whoami answers the saved member and the days left", async () => {
  await expect(json("linkedin_whoami")).resolves.toMatchObject({
    name: "Ada Lovelace",
    personUrn: PERSON_URN,
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
});

it("creates, lists, shows, edits and deletes a post, keeping the local list in step", async () => {
  const created = await json("linkedin_create_post", { text: "Hello (world) #mcp", visibility: "CONNECTIONS" });
  expect(created).toMatchObject({ text: "Hello (world) #mcp", visibility: "CONNECTIONS", author: PERSON_URN });
  const urn = created.urn as string;
  expect(linkedin.posts.get(urn)?.commentary).toBe("Hello \\(world\\) #mcp");

  const listed = await json("linkedin_list_posts");
  expect(listed).toMatchObject({ count: 1, posts: [{ urn }] });
  await expect(json("linkedin_get_post", { post: created.url as string })).resolves.toMatchObject({ urn });

  const edited = await json("linkedin_edit_post", { post: urn, text: "Hello again" });
  expect(edited).toMatchObject({ urn, text: "Hello again", updatedAt: expect.any(String) });
  expect(linkedin.posts.get(urn)?.commentary).toBe("Hello again");

  const refused = await call("linkedin_delete_post", { post: urn, confirm: false });
  expect(refused).toMatchObject({ isError: true, text: expect.stringMatching(/confirm: true/) });
  expect(linkedin.posts.get(urn)?.deleted).toBeUndefined();

  await expect(json("linkedin_delete_post", { post: urn, confirm: true })).resolves.toMatchObject({
    deleted: true,
    urn,
  });
  expect(linkedin.posts.get(urn)?.deleted).toBe(true);
  await expect(json("linkedin_list_posts")).resolves.toMatchObject({ count: 0 });
  await expect(json("linkedin_list_posts", { include_deleted: true })).resolves.toMatchObject({ count: 1 });
});

it("attaches local media and remembers what was attached", async () => {
  const images = ["a.png", "b.png"].map((name) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.alloc(100, 1));
    return { path: file, alt_text: name };
  });
  const created = await json("linkedin_create_post", { text: "two pics", images });
  expect(created.media).toEqual({ kind: "images", files: images.map((image) => image.path) });
  expect(linkedin.lastJson("/rest/posts").content).toMatchObject({
    multiImage: { images: [{ altText: "a.png" }, { altText: "b.png" }] },
  });
});

it("edits a post made elsewhere, and notes that only the edit is known", async () => {
  const { urn } = (await json("linkedin_create_post", { text: "x" })) as { urn: string };
  fs.rmSync(path.join(dir, "posts.json"));
  const edited = await json("linkedin_edit_post", { post: urn, text: "fixed" });
  expect(edited).toMatchObject({ urn, note: expect.stringMatching(/Created outside/) });
});

it("explains that posts made on LinkedIn cannot be read", async () => {
  const result = await call("linkedin_get_post", { post: "urn:li:share:1" });
  expect(result).toMatchObject({ isError: true, text: expect.stringMatching(/does not let it read posts/) });
});

it("answers file and text mistakes as tool errors, without calling LinkedIn", async () => {
  const missing = await call("linkedin_create_post", { text: "x", video: { path: path.join(dir, "nope.mp4") } });
  expect(missing).toMatchObject({ isError: true, text: expect.stringMatching(/does not exist/) });
  const long = await call("linkedin_create_post", { text: "a".repeat(3001) });
  expect(long).toMatchObject({ isError: true, text: expect.stringMatching(/up to 3000/) });
  expect(linkedin.hits("/rest/posts")).toHaveLength(0);
});

it("tells the model to have the user sign in when the sign-in expired", async () => {
  signIn({ expiresAt: "2020-01-01T00:00:00.000Z" });
  const result = await call("linkedin_create_post", { text: "x" });
  expect(result).toMatchObject({
    isError: true,
    text: expect.stringMatching(/^The LinkedIn sign-in expired on 2020-01-01: .*linkedin mcp config --web/),
  });
});

it("explains a 403 with the products the app needs", async () => {
  linkedin.tokens.add("token-other-0123456789");
  await client.close();
  client = await connect({
    LINKEDIN_ACCESS_TOKEN: "token-other-0123456789",
    LINKEDIN_PERSON_URN: "urn:li:person:other",
  });
  const result = await call("linkedin_create_post", { text: "x" });
  expect(result).toMatchObject({
    isError: true,
    text: expect.stringMatching(/LinkedIn answered 403 \(the token lacks a permission/),
  });
  expect(linkedin.hits("/v2/userinfo")).toHaveLength(0);
});
