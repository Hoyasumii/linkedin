import { CommandDef, defineCommand, renderUsage } from "citty";
import { DOCS_URL, SERVER_VERSION } from "../mcp/build";
import { type LoginOverrides, runMcpCli } from "./mcp";
import { McpDeps, defaultMcpDeps } from "./mcp/deps";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: Record<string, string | undefined>;
}

/** Input the CLI refuses: the message is the whole story, without a stack. */
export class CliInputError extends Error {
  override readonly name = "CliInputError";
}

/** Only for the root usage: each subcommand renders its own. */
function buildMain(): CommandDef {
  return defineCommand({
    meta: {
      name: "linkedin",
      version: SERVER_VERSION,
      description:
        "Sign in to LinkedIn and register the LinkedIn MCP server (linkedin-mcp) in Claude Code, Codex or OpenCode.",
    },
    subCommands: {
      mcp: defineCommand({
        meta: {
          name: "mcp",
          description:
            "Sign in (config), register the server in your AI clients (install, uninstall), sign out (logout).",
        },
      }),
      docs: defineCommand({
        meta: { name: "docs", description: `Open the documentation (${DOCS_URL}) in the browser.` },
      }),
    },
  });
}

/**
 * Run the `linkedin` CLI and answer its exit code. It does not post anything itself: posting is the
 * MCP server's job. `linkedin mcp …` signs in and registers the server (see `./mcp`), `linkedin docs`
 * opens the documentation site.
 */
export async function runCli(
  argv: string[],
  io: CliIo,
  deps: Partial<McpDeps> = {},
  login: LoginOverrides = {}
): Promise<number> {
  try {
    const commandAt = argv.findIndex((arg) => !arg.startsWith("-"));
    const command = argv[commandAt];
    const helpFlag = argv.includes("--help") || argv.includes("-h");
    if (command === "mcp") {
      const mcpArgs = [...argv.slice(0, commandAt), ...argv.slice(commandAt + 1)];
      return await runMcpCli(mcpArgs, io, { ...defaultMcpDeps(), ...deps }, login);
    }
    if (command === "docs" && !helpFlag) {
      io.stdout(DOCS_URL);
      const openBrowser = deps.openBrowser ?? defaultMcpDeps().openBrowser;
      await openBrowser(DOCS_URL).catch(() => io.stderr("Could not open a browser; open the link above."));
      return 0;
    }
    if (argv.length === 1 && argv[0] === "--version") {
      io.stdout(SERVER_VERSION);
      return 0;
    }
    const main = buildMain();
    const sub = command === undefined ? undefined : ((main.subCommands ?? {}) as Record<string, CommandDef>)[command];
    const usage = (sub ? await renderUsage(sub, main) : await renderUsage(main)).replace(/[ \t]+$/gm, "");
    if (command !== undefined && !sub) {
      io.stderr(`${usage}\n\nUnknown command ${command}`);
      return 1;
    }
    io.stdout(usage);
    return 0;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
