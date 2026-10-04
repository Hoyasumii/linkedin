import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SyntaxKind, createScanner, findNodeAtLocation, parse as parseJsonc, parseTree } from "jsonc-parser";
import { renameWithRetry } from "../../fs-util";
import { ClientHost, ServerLaunch } from "./hosts";

export type { ServerLaunch } from "./hosts";

type Env = Record<string, string | undefined>;

/** The name the server is registered under in every client. */
export const SERVER_ENTRY = "linkedin";

export type ClientId = "claude" | "codex" | "opencode";

export interface ClientTarget {
  id: ClientId;
  name: string;
  /** The client's own CLI, which does the registering. */
  bin: string;
}

export const CLIENTS: readonly ClientTarget[] = [
  { id: "claude", name: "Claude Code", bin: "claude" },
  { id: "codex", name: "Codex", bin: "codex" },
  { id: "opencode", name: "OpenCode", bin: "opencode" },
];

/** Where OpenCode keeps an entry: the global config file and the JSON path inside it. */
export interface JsoncLocation {
  file: string;
  jsonPath: string[];
}

/** An entry named {@link SERVER_ENTRY} already in a client's user-level config. */
export interface ExistingEntry {
  /** `stdio` or `http` (or whatever else the client records), shown in the pickers. */
  transport: string;
  /** OpenCode only: every place the entry is, for `uninstall` to edit (it has no `mcp remove`). */
  locations?: JsoncLocation[];
}

export interface ClientStatus extends ClientTarget {
  installed: boolean;
  /** First line of `<bin> --version`. */
  version?: string;
  /** The client's existing `linkedin` entry, if any. */
  entry?: ExistingEntry;
  /** Where the client lives. */
  host: ClientHost;
  /** How to run its CLI on that host (what `host.find` answered). */
  command?: string;
}

function home(env: Env): string {
  return env.HOME || env.USERPROFILE || os.homedir();
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function field(value: unknown, ...keys: string[]): unknown {
  let node = value;
  for (const key of keys) {
    if (typeof node !== "object" || node === null || !(key in node)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Claude Code keeps user-scope servers under `mcpServers` in `.claude.json` (`$CLAUDE_CONFIG_DIR` or home). */
function claudeEntry(env: Env): ExistingEntry | undefined {
  const text = readText(path.join(env.CLAUDE_CONFIG_DIR || home(env), ".claude.json"));
  if (text === undefined) return undefined;
  let entry: unknown;
  try {
    entry = field(JSON.parse(text), "mcpServers", SERVER_ENTRY);
  } catch {
    return undefined;
  }
  if (entry === undefined) return undefined;
  const type = field(entry, "type");
  return { transport: typeof type === "string" ? type : field(entry, "url") ? "http" : "stdio" };
}

/** Codex keeps them as `[mcp_servers.<name>]` tables in `$CODEX_HOME/config.toml` (`~/.codex`). */
function codexEntry(env: Env): ExistingEntry | undefined {
  const text = readText(path.join(env.CODEX_HOME || path.join(home(env), ".codex"), "config.toml"));
  if (text === undefined) return undefined;
  const header = new RegExp(`^\\s*\\[mcp_servers\\.(?:${SERVER_ENTRY}|"${SERVER_ENTRY}")\\]\\s*$`, "m").exec(text);
  if (!header) return undefined;
  const rest = text.slice(header.index + header[0].length);
  const body = rest.slice(0, rest.search(/^\s*\[/m) === -1 ? undefined : rest.search(/^\s*\[/m));
  return { transport: /^\s*url\s*=/m.test(body) ? "http" : "stdio" };
}

/** OpenCode's global config files, in the order OpenCode reads them. */
export function opencodeConfigFiles(env: Env): string[] {
  const dir = path.join(env.XDG_CONFIG_HOME || path.join(home(env), ".config"), "opencode");
  return ["config.json", "opencode.json", "opencode.jsonc"].map((name) => path.join(dir, name));
}

/** `mcp.servers.<name>` (v2) or `mcp.<name>` (v1), in any of the global files; comments allowed. */
function opencodeEntry(env: Env): ExistingEntry | undefined {
  const locations: JsoncLocation[] = [];
  let transport = "stdio";
  for (const file of opencodeConfigFiles(env)) {
    const text = readText(file);
    if (text === undefined) continue;
    const config: unknown = parseJsonc(text, [], { allowTrailingComma: true });
    for (const jsonPath of [
      ["mcp", "servers", SERVER_ENTRY],
      ["mcp", SERVER_ENTRY],
    ]) {
      const entry = field(config, ...jsonPath);
      if (entry === undefined) continue;
      locations.push({ file, jsonPath });
      if (field(entry, "type") === "remote") transport = "http";
    }
  }
  return locations.length > 0 ? { transport, locations } : undefined;
}

const FIND_ENTRY: Record<ClientId, (env: Env) => ExistingEntry | undefined> = {
  claude: claudeEntry,
  codex: codexEntry,
  opencode: opencodeEntry,
};

/** Every client on every host: whether it answers `--version`, and whether it already has a `linkedin` entry. */
export async function detectClients(hosts: ClientHost[]): Promise<ClientStatus[]> {
  const rows = hosts.flatMap((host) => CLIENTS.map((client) => ({ host, client })));
  return Promise.all(
    rows.map(async ({ host, client }) => {
      const found = await host.find(client.bin);
      return {
        ...client,
        host,
        installed: found !== undefined,
        command: found?.command,
        version: found?.version,
        entry: found ? FIND_ENTRY[client.id](host.env) : undefined,
      };
    })
  );
}

/** `Claude Code`, or `Claude Code (Windows)` on the bridge host. */
export function displayName(client: ClientStatus): string {
  return client.host.label ? `${client.name} (${client.host.label})` : client.name;
}

/** The id `--client` takes for it: `claude`, or `claude@windows`. */
export function flagId(client: ClientStatus): string {
  return `${client.id}${client.host.qualifier}`;
}

export interface InstallStep {
  command: string;
  args: string[];
  /** A step whose failure does not fail the install (removing an entry before re-adding it). */
  optional?: boolean;
}

/** The client CLI calls that register the server; `replace` first drops an existing entry where `add` would refuse. */
export function installSteps(client: ClientStatus, launch: ServerLaunch, replace: boolean): InstallStep[] {
  const bin = client.command ?? client.bin;
  const envPairs = Object.entries(launch.env).map(([key, value]) => `${key}=${value}`);
  switch (client.id) {
    case "claude":
      return [
        ...(replace ? [{ command: bin, args: ["mcp", "remove", "-s", "user", SERVER_ENTRY], optional: true }] : []),
        {
          command: bin,
          // `-e` is variadic, so the name goes before it and `--` ends it.
          args: [
            "mcp",
            "add",
            SERVER_ENTRY,
            "-s",
            "user",
            ...envPairs.flatMap((pair) => ["-e", pair]),
            "--",
            ...launch.command,
          ],
        },
      ];
    case "codex":
      return [
        ...(replace ? [{ command: bin, args: ["mcp", "remove", SERVER_ENTRY], optional: true }] : []),
        {
          command: bin,
          args: ["mcp", "add", SERVER_ENTRY, ...envPairs.flatMap((pair) => ["--env", pair]), "--", ...launch.command],
        },
      ];
    case "opencode":
      // `opencode mcp add` overwrites an entry of the same name; there is no `remove`.
      return [
        {
          command: bin,
          args: [
            "mcp",
            "add",
            "--global",
            ...envPairs.flatMap((pair) => ["--env", pair]),
            SERVER_ENTRY,
            "--",
            ...launch.command,
          ],
        },
      ];
  }
}

/** A step as a shell-readable line, for `--dry-run` and error messages. */
export function formatStep(step: InstallStep): string {
  const quote = (arg: string): string => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`);
  return [step.command, ...step.args].map(quote).join(" ");
}

export interface InstallOutcome {
  ok: boolean;
  /** What went wrong: the failing command and its output. */
  detail?: string;
}

export async function runSteps(host: ClientHost, steps: InstallStep[]): Promise<InstallOutcome> {
  for (const step of steps) {
    const result = await host.exec(step.command, step.args);
    if (result.code !== 0 && !step.optional) {
      const output = (result.stderr || result.stdout).trim();
      return { ok: false, detail: `${formatStep(step)} exited ${result.code}${output ? `: ${output}` : ""}` };
    }
  }
  return { ok: true };
}

/** One way `uninstall` removes an entry: a client CLI call, or (OpenCode) an edit of its config file. */
export type UninstallAction = { kind: "exec"; step: InstallStep } | { kind: "edit"; location: JsoncLocation };

export function uninstallActions(client: ClientStatus): UninstallAction[] {
  switch (client.id) {
    case "claude":
      return [
        {
          kind: "exec",
          step: { command: client.command ?? client.bin, args: ["mcp", "remove", "-s", "user", SERVER_ENTRY] },
        },
      ];
    case "codex":
      return [{ kind: "exec", step: { command: client.command ?? client.bin, args: ["mcp", "remove", SERVER_ENTRY] } }];
    case "opencode":
      // `opencode mcp` has no `remove`: drop the key from the file, keeping its comments and layout.
      return (client.entry?.locations ?? []).map((location) => ({ kind: "edit", location }));
  }
}

export function formatAction(action: UninstallAction): string {
  return action.kind === "exec"
    ? formatStep(action.step)
    : `remove ${action.location.jsonPath.join(".")} from ${action.location.file}`;
}

/** The offset just past the comma that follows `offset` (skipping whitespace and comments), or `undefined`. */
function commaAfter(text: string, offset: number): number | undefined {
  const scanner = createScanner(text.slice(offset), false);
  for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
    if (token === SyntaxKind.CommaToken) return offset + scanner.getTokenOffset() + 1;
    if (
      token !== SyntaxKind.Trivia &&
      token !== SyntaxKind.LineBreakTrivia &&
      token !== SyntaxKind.LineCommentTrivia &&
      token !== SyntaxKind.BlockCommentTrivia
    ) {
      return undefined;
    }
  }
  return undefined;
}

/**
 * `text` without the property at `jsonPath`, everything else kept byte for byte — including the
 * comments around it, which a generic JSONC edit reformats or drops. A property on lines of its
 * own goes with those lines (and a `//` comment ending its last line); when it was the last one,
 * the comma it leaves dangling on its previous sibling goes too, unless the file uses trailing commas.
 */
export function removeJsoncProperty(text: string, jsonPath: string[]): string {
  const value = findNodeAtLocation(parseTree(text) ?? { type: "null", offset: 0, length: 0 }, jsonPath);
  const property = value?.parent;
  const siblings = property?.parent?.children;
  if (!property || property.type !== "property" || !siblings) return text;

  let start = property.offset;
  let end = commaAfter(text, property.offset + property.length) ?? property.offset + property.length;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEndAt = text.indexOf("\n", end);
  const lineEnd = lineEndAt === -1 ? text.length : lineEndAt;
  if (text.slice(lineStart, start).trim() === "" && /^\s*(\/\/.*)?$/.test(text.slice(end, lineEnd))) {
    start = lineStart;
    end = lineEndAt === -1 ? text.length : lineEnd + 1;
  }

  const index = siblings.indexOf(property);
  const hadComma = commaAfter(text, property.offset + property.length) !== undefined;
  if (index === siblings.length - 1 && index > 0 && !hadComma) {
    const previous = siblings[index - 1];
    const comma = commaAfter(text, previous.offset + previous.length);
    if (comma !== undefined && comma <= start) {
      return text.slice(0, comma - 1) + text.slice(comma, start) + text.slice(end);
    }
  }
  return text.slice(0, start) + text.slice(end);
}

/** Delete one key from a JSONC file; the file is replaced in one rename, keeping its mode. */
export function removeJsoncKey(location: JsoncLocation): void {
  const text = fs.readFileSync(location.file, "utf8");
  const temporary = `${location.file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, removeJsoncProperty(text, location.jsonPath), { mode: fs.statSync(location.file).mode });
  renameWithRetry(temporary, location.file);
}

export async function runUninstall(host: ClientHost, actions: UninstallAction[]): Promise<InstallOutcome> {
  for (const action of actions) {
    if (action.kind === "exec") {
      const outcome = await runSteps(host, [action.step]);
      if (!outcome.ok) return outcome;
      continue;
    }
    try {
      removeJsoncKey(action.location);
    } catch (error) {
      return {
        ok: false,
        detail: `${formatAction(action)}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return { ok: true };
}
