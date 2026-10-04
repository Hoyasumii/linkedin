/**
 * Against the real LinkedIn. Runs only with LINKEDIN_LIVE=1 (read from `.env.test`): `pnpm test:live`.
 *
 * It posts as the signed-in member — LINKEDIN_ACCESS_TOKEN, or the sign-in `linkedin mcp config
 * --web` saved — visible to 1st-degree connections only, edits it and deletes it within seconds.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { credentialsPath, readCredentials } from "../../src/auth/credentials";
import { buildLinkedInMcpServer, configFilePath, connectionFor, resolveMcpConfig } from "../../src/mcp";

const env = process.env;
const saved = readCredentials(credentialsPath(configFilePath(env)));
const token = env.LINKEDIN_ACCESS_TOKEN || saved?.accessToken;
const configured = env.LINKEDIN_LIVE === "1" && Boolean(token);

(configured ? describe : describe.skip)("real LinkedIn", () => {
  let mcp: Client;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-live-"));
    const config = resolveMcpConfig({
      configFile: path.join(dir, ".env"),
      env: {
        LINKEDIN_ACCESS_TOKEN: token as string,
        ...(env.LINKEDIN_PERSON_URN || saved
          ? { LINKEDIN_PERSON_URN: env.LINKEDIN_PERSON_URN || saved?.personUrn }
          : {}),
        ...(env.LINKEDIN_API_VERSION ? { LINKEDIN_API_VERSION: env.LINKEDIN_API_VERSION } : {}),
      } as Record<string, string>,
    });
    const server = buildLinkedInMcpServer(connectionFor(config));
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    mcp = new Client({ name: "live", version: "0" });
    await mcp.connect(clientSide);
  });
  afterAll(async () => {
    await mcp?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // oxlint-disable-next-line typescript/no-explicit-any -- the tools' JSON is walked freely
  async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const result = await mcp.callTool({ name, arguments: args });
    const text = (result.content as { text: string }[]).map((part) => part.text).join("");
    if (result.isError) throw new Error(`${name}: ${text}`);
    return JSON.parse(text);
  }

  it("creates, edits and deletes a connections-only post", async () => {
    const stamp = new Date().toISOString();
    const created = await call("linkedin_create_post", {
      text: `Testing an API integration (please ignore) — ${stamp} #test`,
      visibility: "CONNECTIONS",
    });
    expect(created.urn).toMatch(/^urn:li:(share|ugcPost):\d+$/);
    try {
      const edited = await call("linkedin_edit_post", { post: created.urn, text: `Edited (please ignore) — ${stamp}` });
      expect(edited.text).toContain("Edited");
      expect((await call("linkedin_list_posts")).posts[0].urn).toBe(created.urn);
    } finally {
      await call("linkedin_delete_post", { post: created.urn, confirm: true });
    }
  });
});
