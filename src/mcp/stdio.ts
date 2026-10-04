import { Readable, Writable } from "node:stream";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildLinkedInMcpServer } from "./build";
import type { LinkedInConnection } from "./config";

export interface LinkedInMcpStdioOptions {
  /** Where requests arrive. Default: `process.stdin`. */
  stdin?: Readable;
  /** Where responses go. Default: `process.stdout` — so nothing else may write to it. */
  stdout?: Writable;
}

export interface RunningLinkedInMcpStdio {
  /** Settles once the connection is over: the client closed stdin, or {@link close} was called. */
  closed: Promise<void>;
  /** Stop reading stdin and close the server. */
  close(): Promise<void>;
}

/**
 * Serve the LinkedIn MCP server over stdio: newline-delimited JSON-RPC on stdin/stdout, the way an
 * MCP client runs a server it launched itself.
 *
 * stdout carries the protocol; log to stderr only. Resolves once connected; `closed` settles when
 * the client closes stdin.
 *
 * ```ts
 * import { configFilePath, connectionFor, readEnvFile, resolveMcpConfig, serveLinkedInMcpStdio } from "@hoyasumii/linkedin/mcp";
 * const configFile = configFilePath();
 * const config = resolveMcpConfig({ env: process.env, file: readEnvFile(configFile), configFile });
 * const mcp = await serveLinkedInMcpStdio(connectionFor(config));
 * await mcp.closed;
 * ```
 */
export async function serveLinkedInMcpStdio(
  connection: LinkedInConnection,
  options: LinkedInMcpStdioOptions = {}
): Promise<RunningLinkedInMcpStdio> {
  const server = buildLinkedInMcpServer(connection);
  const stdin = options.stdin ?? process.stdin;
  const transport = new StdioServerTransport(stdin, options.stdout ?? process.stdout);

  let settle: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const onEnd = (): void => {
    void server.close();
  };
  server.server.onclose = () => {
    stdin.off("end", onEnd);
    settle();
  };
  stdin.once("end", onEnd);
  await server.connect(transport);

  return {
    closed,
    close: async () => {
      await server.close();
      await closed;
    },
  };
}
