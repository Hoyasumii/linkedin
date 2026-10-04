import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { runCli } from "../../../src/cli/run";
import { removeJsoncProperty } from "../../../src/cli/mcp/install";
import { ExecResult, McpDeps } from "../../../src/cli/mcp/deps";
import { credentialsPath, writeCredentials } from "../../../src/auth/credentials";

let home: string;
let configFile: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-mcp-install-"));
  configFile = path.join(home, ".config", "linkedin", ".env");
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const CLI_ENTRY = "/opt/linkedin/dist/cli/index.js";
/** What `nativeHost` derives from CLI_ENTRY, with the separators of the OS running the test. */
const SCRIPT = path.join(path.dirname(CLI_ENTRY), "..", "mcp", "cli.js");

const VERSIONS: Record<string, string> = {
  claude: "2.1.282 (Claude Code)\n",
  codex: "codex-cli 0.46.0\n",
  opencode: "opencode v2.0.14\n",
};

/** Fake OS: the named client CLIs answer `--version`, every other binary is missing (127). */
function fakeDeps(installed: string[], overrides: Partial<McpDeps> = {}) {
  const execs: string[][] = [];
  const failing = new Set<string>();
  const deps: Partial<McpDeps> = {
    platform: "linux",
    nodePath: "/usr/bin/node",
    cliEntry: CLI_ENTRY,
    isWsl: () => false,
    terminal: undefined,
    exec: async (command: string, args: string[]): Promise<ExecResult> => {
      if (!installed.includes(command)) return { code: 127, stdout: "", stderr: `spawn ${command} ENOENT` };
      if (args[0] === "--version") return { code: 0, stdout: VERSIONS[command], stderr: "" };
      execs.push([command, ...args]);
      if (failing.has(command)) return { code: 1, stdout: "", stderr: "boom" };
      return { code: 0, stdout: "", stderr: "" };
    },
    ...overrides,
  };
  return { deps, execs, failing };
}

/** A raw-mode terminal with `keys` already queued. */
function terminal(keys: string[]) {
  const input = Object.assign(new PassThrough(), { isRaw: false, setRawMode: () => undefined });
  const output = new PassThrough();
  output.resume();
  for (const key of keys) input.write(key);
  return { input, output };
}

async function run(command: string, argv: string[], deps: Partial<McpDeps>, env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(
    ["mcp", command, ...argv],
    { stdout: (text) => out.push(text), stderr: (text) => err.push(text), env: { HOME: home, ...env } },
    deps
  );
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

const cli = (argv: string[], deps: Partial<McpDeps>, env: Record<string, string> = {}) =>
  run("install", argv, deps, env);
const uninstall = (argv: string[], deps: Partial<McpDeps>, env: Record<string, string> = {}) =>
  run("uninstall", argv, deps, env);

const SERVER = ["--", "/usr/bin/node", SCRIPT];

/** A sign-in beside `file`: what `install` needs. */
function signIn(file: string): void {
  writeCredentials(credentialsPath(file), {
    accessToken: "token-0123456789",
    expiresAt: "2099-01-01T00:00:00.000Z",
    scopes: ["w_member_social"],
    personUrn: "urn:li:person:x",
    savedAt: "2026-10-04T00:00:00.000Z",
  });
}

function save(): void {
  signIn(configFile);
}

describe("linkedin mcp install", () => {
  it("refuses without a sign-in, before detecting anything", async () => {
    const { deps, execs } = fakeDeps(["claude"]);
    const result = await cli(["--client", "claude"], deps, { LINKEDIN_ACCESS_TOKEN: "from-env" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("run `linkedin mcp config --web` first");
    expect(execs).toEqual([]);
  });

  it("registers the stdio server in each picked client, pre-checking the ones found", async () => {
    save();
    const { deps, execs } = fakeDeps(["claude", "opencode"], { terminal: terminal(["\r"]) });
    const result = await cli([], deps);
    expect(result.code).toBe(0);
    expect(execs).toEqual([
      ["claude", "mcp", "add", "linkedin", "-s", "user", ...SERVER],
      ["opencode", "mcp", "add", "--global", "linkedin", ...SERVER],
    ]);
    expect(result.stdout).toContain("✔ Claude Code  registered as 'linkedin'");
    expect(result.stdout).toContain("✔ OpenCode     registered as 'linkedin'");
    // No key in any client config: the server reads the saved file.
    expect(execs.flat().join(" ")).not.toContain("LINKEDIN_API_KEY");
  });

  it("pre-checks a client that already has the entry, reinstalling it unless unchecked", async () => {
    save();
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { linkedin: { type: "http" } } }));
    const replaced = fakeDeps(["claude"], { terminal: terminal(["\r"]) });
    const result = await cli([], replaced.deps);
    expect(replaced.execs).toEqual([
      ["claude", "mcp", "remove", "-s", "user", "linkedin"],
      ["claude", "mcp", "add", "linkedin", "-s", "user", ...SERVER],
    ]);
    expect(result.stdout).toContain("(replaced)");

    // Space on the first row (Claude Code) unchecks it; OpenCode stays checked.
    const skipped = fakeDeps(["claude", "opencode"], { terminal: terminal([" ", "\r"]) });
    await cli([], skipped.deps);
    expect(skipped.execs.map((call) => call[0])).toEqual(["opencode"]);
  });

  it("exits 130 and changes nothing when the picker is cancelled", async () => {
    save();
    const { deps, execs } = fakeDeps(["claude"], { terminal: terminal(["\x1b"]) });
    expect((await cli([], deps)).code).toBe(130);
    expect(execs).toEqual([]);
  });

  it("needs --client without a terminal, and refuses unknown, missing or taken clients", async () => {
    save();
    fs.mkdirSync(path.join(home, ".codex"));
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), '[mcp_servers.linkedin]\ncommand = "x"\n');
    const { deps } = fakeDeps(["claude", "codex"]);
    expect((await cli([], deps)).stderr).toContain("pass --client claude,codex,opencode");
    expect((await cli(["--client", "cursor"], deps)).stderr).toContain("Unknown client 'cursor'");
    expect((await cli(["--client", "opencode"], deps)).stderr).toContain("OpenCode was not found");
    expect((await cli(["--client", "codex"], deps)).stderr).toContain("pass --force to replace it");
  });

  it("installs from --client, replacing with --force, and passes a non-default config path", async () => {
    const other = path.join(home, "work.env");
    signIn(other);
    fs.mkdirSync(path.join(home, ".codex"));
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), '[mcp_servers."linkedin"]\n');
    const { deps, execs } = fakeDeps(["claude", "codex"]);
    const result = await cli(["--client", "codex,claude", "--force", "--config", other], deps);
    expect(result.code).toBe(0);
    expect(execs).toEqual([
      ["codex", "mcp", "remove", "linkedin"],
      ["codex", "mcp", "add", "linkedin", "--env", `LINKEDIN_CONFIG=${other}`, ...SERVER],
      ["claude", "mcp", "add", "linkedin", "-s", "user", "-e", `LINKEDIN_CONFIG=${other}`, ...SERVER],
    ]);
  });

  it("prints the commands and runs nothing with --dry-run", async () => {
    save();
    const { deps, execs } = fakeDeps(["opencode"]);
    const result = await cli(["--client", "opencode", "--dry-run"], deps);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("opencode mcp add --global linkedin -- /usr/bin/node");
    expect(result.stdout).toContain(SCRIPT);
    expect(execs).toEqual([]);
  });

  it("reports a client that fails and exits 1, still installing the others", async () => {
    save();
    const { deps, execs, failing } = fakeDeps(["claude", "opencode"]);
    failing.add("claude");
    const result = await cli(["--client", "claude,opencode"], deps);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("✘ Claude Code  claude mcp add linkedin -s user -- /usr/bin/node");
    expect(result.stderr).toContain("exited 1: boom");
    expect(execs.map((call) => call[0])).toEqual(["claude", "opencode"]);
  });

  it("finds an OpenCode entry in a commented opencode.jsonc", async () => {
    save();
    const dir = path.join(home, ".config", "opencode");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "opencode.jsonc"),
      '{\n  // servers\n  "mcp": { "servers": { "linkedin": { "type": "local", /* x */ "command": ["a//b"], }, }, },\n}\n'
    );
    const { deps } = fakeDeps(["opencode"]);
    expect((await cli(["--client", "opencode"], deps)).stderr).toContain("pass --force to replace it");
  });
});

describe("linkedin mcp uninstall", () => {
  const OPENCODE_JSONC = `{
  // my theme
  "theme": "dark",
  "mcp": {
    "servers": {
      "other": { "type": "local", "command": ["x"] }, // keep me
      "linkedin": { "type": "local", "command": ["/usr/bin/node", "/opt/linkedin/dist/mcp/cli.js"] },
    },
  },
}
`;

  function withEntries(): string {
    fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { linkedin: { type: "stdio" } } }));
    const dir = path.join(home, ".config", "opencode");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "opencode.jsonc");
    fs.writeFileSync(file, OPENCODE_JSONC);
    return file;
  }

  it("runs without a sign-in and removes every checked entry", async () => {
    const file = withEntries();
    const { deps, execs } = fakeDeps(["claude", "codex", "opencode"], { terminal: terminal(["\r"]) });
    const result = await uninstall([], deps);
    expect(result.code).toBe(0);
    expect(execs).toEqual([["claude", "mcp", "remove", "-s", "user", "linkedin"]]);
    expect(result.stdout).toContain("✔ Claude Code  removed 'linkedin'");
    expect(result.stdout).toContain("✔ OpenCode     removed 'linkedin'");
    // Only the entry goes; comments, the other server and the rest of the file stay.
    const after = fs.readFileSync(file, "utf8");
    expect(after).not.toContain('"linkedin"');
    expect(after).toContain("// my theme");
    expect(after).toContain('"other": { "type": "local", "command": ["x"] }');
    expect(after).toContain('"theme": "dark"');
  });

  it("offers only clients with an entry, and leaves unchecked ones alone", async () => {
    const file = withEntries();
    // Codex is installed but has no entry, so it is disabled: the cursor starts on Claude Code.
    const { deps, execs } = fakeDeps(["claude", "codex", "opencode"], { terminal: terminal([" ", "\r"]) });
    const result = await uninstall([], deps);
    expect(execs).toEqual([]);
    expect(result.stdout).not.toContain("Claude Code");
    expect(fs.readFileSync(file, "utf8")).not.toContain('"linkedin"');
  });

  it("refuses when no client has an entry, and --client naming one without it", async () => {
    const { deps } = fakeDeps(["claude"], { terminal: terminal(["\r"]) });
    expect((await uninstall([], deps)).stderr).toContain("No client has an MCP server named 'linkedin'");
    expect((await uninstall(["--client", "claude"], deps)).stderr).toContain(
      "Claude Code has no MCP server named 'linkedin'"
    );
  });

  it("prints what it would do with --dry-run and changes nothing", async () => {
    const file = withEntries();
    fs.mkdirSync(path.join(home, ".codex"));
    fs.writeFileSync(path.join(home, ".codex", "config.toml"), '[mcp_servers.linkedin]\nurl = "http://x"\n');
    const { deps, execs } = fakeDeps(["claude", "codex", "opencode"]);
    const result = await uninstall(["--client", "codex,opencode", "--dry-run"], deps);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("codex mcp remove linkedin");
    expect(result.stdout).toContain(`remove mcp.servers.linkedin from ${file}`);
    expect(execs).toEqual([]);
    expect(fs.readFileSync(file, "utf8")).toBe(OPENCODE_JSONC);
  });

  it("shows each entry's transport in the picker", async () => {
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { linkedin: { type: "http", url: "u" } } })
    );
    const term = terminal(["\x1b"]);
    let drawn = "";
    term.output.on("data", (chunk: Buffer) => (drawn += chunk.toString()));
    const { deps } = fakeDeps(["claude"], { terminal: term });
    expect((await uninstall([], deps)).code).toBe(130);
    expect(drawn).toContain("2.1.282 (Claude Code) · http");
  });
});

describe("removeJsoncProperty", () => {
  const PATH = ["mcp", "servers", "linkedin"];

  it("drops a multi-line first property with its own comment, keeping the neighbour's", () => {
    const text =
      '{\n  "mcp": {\n    "servers": {\n      "linkedin": {\n        "type": "local"\n      }, // about linkedin\n      "other": 1 // keep me\n    }\n  }\n}\n';
    expect(removeJsoncProperty(text, PATH)).toBe(
      '{\n  "mcp": {\n    "servers": {\n      "other": 1 // keep me\n    }\n  }\n}\n'
    );
  });

  it("takes the dangling comma off the previous sibling when the file has no trailing commas", () => {
    const text = '{\n  "mcp": {\n    "servers": {\n      "other": 1, // keep me\n      "linkedin": 2\n    }\n  }\n}\n';
    expect(removeJsoncProperty(text, PATH)).toBe(
      '{\n  "mcp": {\n    "servers": {\n      "other": 1 // keep me\n    }\n  }\n}\n'
    );
  });

  it("handles one-line objects and leaves a file without the path untouched", () => {
    expect(removeJsoncProperty('{"mcp":{"servers":{"a":1,"linkedin":{"t":1},"b":2}}}', PATH)).toBe(
      '{"mcp":{"servers":{"a":1,"b":2}}}'
    );
    expect(removeJsoncProperty('{"mcp":{"servers":{"a":1,"linkedin":{"t":1}}}}', PATH)).toBe(
      '{"mcp":{"servers":{"a":1}}}'
    );
    expect(removeJsoncProperty('{"mcp":{}}', PATH)).toBe('{"mcp":{}}');
  });
});

describe("linkedin mcp install from WSL", () => {
  /** Linux side has nothing; the Windows side has claude.exe. */
  function bridgeDeps(extra: Partial<McpDeps> = {}) {
    const execs: string[][] = [];
    const deps: Partial<McpDeps> = {
      platform: "linux",
      nodePath: "/usr/bin/node",
      cliEntry: "/opt/linkedin/dist/cli/index.js",
      terminal: undefined,
      isWsl: () => true,
      exec: async (command: string, args: string[]): Promise<ExecResult> => {
        if (command === "powershell.exe") {
          return {
            code: 0,
            stdout: JSON.stringify({
              home: "C:\\Users\\ada",
              bins: { claude: "C:\\Users\\ada\\.local\\bin\\claude.exe", codex: null, opencode: null },
            }),
            stderr: "",
          };
        }
        if (command === "wslpath")
          return { code: 0, stdout: `${args[1].replace("C:\\", "/mnt/c/").replace(/\\/g, "/")}\n`, stderr: "" };
        if (command === "/mnt/c/Users/ada/.local/bin/claude.exe") {
          if (args[0] === "--version") return { code: 0, stdout: "2.1.280 (Claude Code)\n", stderr: "" };
          execs.push([command, ...args]);
          return { code: 0, stdout: "", stderr: "" };
        }
        return { code: 127, stdout: "", stderr: "ENOENT" };
      },
      ...extra,
    };
    return { deps, execs };
  }

  it("registers into the Windows client with a wsl.exe launch", async () => {
    save();
    const { deps, execs } = bridgeDeps();
    const result = await cli(["--client", "claude@windows"], deps, { WSL_DISTRO_NAME: "Ubuntu" });
    expect(result.stderr).toBe("");
    expect(execs).toEqual([
      [
        "/mnt/c/Users/ada/.local/bin/claude.exe",
        "mcp",
        "add",
        "linkedin",
        "-s",
        "user",
        "--",
        "wsl.exe",
        "-d",
        "Ubuntu",
        "-e",
        "/usr/bin/node",
        "/opt/linkedin/dist/mcp/cli.js",
      ],
    ]);
    expect(result.stdout).toContain("✔ Claude Code (Windows)  registered as 'linkedin'");
  });

  it("shows Windows rows in the picker with a via wsl.exe hint", async () => {
    save();
    const output = new PassThrough();
    let drawn = "";
    output.on("data", (chunk: Buffer) => (drawn += chunk.toString()));
    const input = Object.assign(new PassThrough(), { isRaw: false, setRawMode: () => undefined });
    input.write("\x1b");
    const { deps } = bridgeDeps({ terminal: { input, output } });
    expect((await cli([], deps, { WSL_DISTRO_NAME: "Ubuntu" })).code).toBe(130);
    expect(drawn).toContain("Claude Code (Windows)");
    expect(drawn).toContain("2.1.280 (Claude Code) · via wsl.exe");
  });

  it("says why a Windows client is unreachable instead of calling it unknown", async () => {
    save();
    const { deps } = bridgeDeps({ isWsl: () => false });
    const result = await cli(["--client", "claude@windows"], deps);
    expect(result.stderr).toContain("'claude@windows' needs the Windows side reachable from WSL");
    expect(result.stderr).toContain("this is not WSL");
    expect((await cli(["--client", "cursor"], deps)).stderr).toContain("Unknown client 'cursor'.");
  });

  it("names the Windows clients in --client's help and in the no-terminal message", async () => {
    save();
    const { deps } = bridgeDeps();
    expect((await cli(["--help"], deps)).stdout).toContain("claude@windows");
    expect((await uninstall(["--help"], deps)).stdout).toContain("claude@windows");
    expect((await cli([], deps, { WSL_DISTRO_NAME: "Ubuntu" })).stderr).toContain(
      "pass --client claude,codex,opencode,claude@windows,codex@windows,opencode@windows"
    );
  });
});
