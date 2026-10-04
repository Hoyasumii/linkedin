import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { RunningLinkedInMcpStdio, connectionFor, resolveMcpConfig, serveLinkedInMcpStdio } from "../../../src/mcp";
import { parseLinkedInMcpArgs } from "../../../src/mcp/cli";
import { FakeLinkedIn, PERSON_URN } from "../fake-server";

/** The client end of a stdio pipe: newline-delimited JSON-RPC over a pair of streams. */
class StreamClientTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private readonly buffer = new ReadBuffer();

  constructor(
    private readonly input: Readable,
    private readonly output: Writable
  ) {}

  async start(): Promise<void> {
    this.input.on("data", (chunk: Buffer) => {
      this.buffer.append(chunk);
      for (let message = this.buffer.readMessage(); message; message = this.buffer.readMessage()) {
        this.onmessage?.(message);
      }
    });
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.output.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

let running: RunningLinkedInMcpStdio | undefined;
let linkedin: FakeLinkedIn;
let dir: string;
beforeEach(async () => {
  linkedin = await FakeLinkedIn.start();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-stdio-"));
});
afterEach(async () => {
  await running?.close();
  running = undefined;
  await linkedin.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function serve(): Promise<{ client: Client; stdin: PassThrough }> {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const config = resolveMcpConfig({
    configFile: path.join(dir, ".env"),
    env: { LINKEDIN_ACCESS_TOKEN: "token-0123456789", LINKEDIN_PERSON_URN: PERSON_URN },
  });
  running = await serveLinkedInMcpStdio(connectionFor(config, { baseUrl: linkedin.url }), { stdin, stdout });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(new StreamClientTransport(stdout, stdin));
  return { client, stdin };
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text: string }[]).map((part) => part.text).join("");
}

describe("serveLinkedInMcpStdio", () => {
  it("serves the tools over stdin/stdout and posts with the token", async () => {
    const { client } = await serve();
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["linkedin_create_post", "linkedin_delete_post"]));
    const result = await client.callTool({ name: "linkedin_create_post", arguments: { text: "hello" } });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('"urn": "urn:li:share:');
    expect(linkedin.hits("/rest/posts")[0].headers.authorization).toBe("Bearer token-0123456789");
  });

  it("settles `closed` when the client closes stdin", async () => {
    const { stdin } = await serve();
    stdin.end();
    await expect(running?.closed).resolves.toBeUndefined();
  });
});

describe("parseLinkedInMcpArgs", () => {
  it("takes --help, -h and --stdio", () => {
    expect(parseLinkedInMcpArgs([])).toEqual({ help: false });
    expect(parseLinkedInMcpArgs(["--stdio"])).toEqual({ help: false });
    expect(parseLinkedInMcpArgs(["-h"])).toEqual({ help: true });
  });

  it("refuses anything else", () => {
    expect(() => parseLinkedInMcpArgs(["--http"])).toThrow("Unknown argument '--http'");
  });
});
