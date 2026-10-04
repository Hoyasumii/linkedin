#!/usr/bin/env node
/**
 * `linkedin-mcp`: run the MCP server over stdio, the way an MCP client launches it. `linkedin mcp
 * install` registers this command in Claude Code, Codex and OpenCode.
 *
 * Settings come from the environment, then the configuration saved by `linkedin mcp config`; the
 * sign-in is read from `credentials.json` beside it on every request.
 */
import { configFilePath, connectionFor, readEnvFile, resolveMcpConfig } from "./config";
import { serveLinkedInMcpStdio } from "./stdio";

const USAGE = `Usage: linkedin-mcp [--help]

Run the LinkedIn MCP server over stdio, for a client that launches it (\`linkedin mcp install\`
registers it in Claude Code, Codex and OpenCode).

Sign in first with \`linkedin mcp config --web\`. The configuration is read from LINKEDIN_CONFIG
(default: the per-user config dir); LINKEDIN_ACCESS_TOKEN (and LINKEDIN_PERSON_URN) in the
environment replace the saved sign-in, LINKEDIN_API_VERSION the LinkedIn-Version header.
`;

/** Whether the arguments ask for help; anything else is refused. */
export function parseLinkedInMcpArgs(argv: readonly string[]): { help: boolean } {
  for (const arg of argv) {
    if (arg !== "--help" && arg !== "-h" && arg !== "--stdio")
      throw new TypeError(`Unknown argument '${arg}'.\n\n${USAGE}`);
  }
  return { help: argv.includes("--help") || argv.includes("-h") };
}

async function main(): Promise<void> {
  if (parseLinkedInMcpArgs(process.argv.slice(2)).help) {
    process.stdout.write(USAGE);
    return;
  }
  const configFile = configFilePath(process.env);
  const config = resolveMcpConfig({ env: process.env, file: readEnvFile(configFile), configFile });
  const server = await serveLinkedInMcpStdio(connectionFor(config));
  // stdout is the protocol channel: everything else goes to stderr.
  // oxlint-disable-next-line no-console
  console.error("LinkedIn MCP server running on stdio");
  await server.closed;
  process.exit(0);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // oxlint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
