import * as path from "node:path";
import { ExecOptions, ExecResult, McpDeps } from "../../../src/cli/mcp/deps";
import {
  FIND_TIMEOUT_MS,
  POWERSHELL_FALLBACK,
  cmdCommandLine,
  decodePowerShell,
  detectHosts,
  nativeHost,
  psQuote,
  windowsHost,
} from "../../../src/cli/mcp/hosts";

type Call = { command: string; args: string[]; options?: ExecOptions };

/** Deps whose exec answers from `answer`, recording every call. */
function fakeHostDeps(answer: (call: Call) => ExecResult, overrides: Partial<McpDeps> = {}) {
  const calls: Call[] = [];
  const deps = {
    platform: "linux",
    nodePath: "/usr/bin/node",
    cliEntry: "/opt/linkedin/dist/cli/index.js",
    isWsl: () => false,
    exec: async (command: string, args: string[], options?: ExecOptions) => {
      const call = { command, args, options };
      calls.push(call);
      return answer(call);
    },
    ...overrides,
  } as McpDeps;
  return { deps, calls };
}

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: "" });
const missing: ExecResult = { code: 127, stdout: "", stderr: "ENOENT" };

describe("nativeHost", () => {
  it("finds a client by its --version, bounded by FIND_TIMEOUT_MS", async () => {
    const { deps, calls } = fakeHostDeps((call) =>
      call.command === "claude" ? ok("2.1.282 (Claude Code)\r\n") : missing
    );
    const host = nativeHost(deps, { HOME: "/home/ada" });
    await expect(host.find("claude")).resolves.toEqual({ command: "claude", version: "2.1.282 (Claude Code)" });
    await expect(host.find("codex")).resolves.toBeUndefined();
    expect(calls[0]).toEqual({ command: "claude", args: ["--version"], options: { timeoutMs: FIND_TIMEOUT_MS } });
  });

  it("launches node on the packaged cli.js, adding LINKEDIN_CONFIG only for a non-default file", () => {
    const { deps } = fakeHostDeps(() => missing);
    const host = nativeHost(deps, { HOME: "/home/ada" });
    const script = path.join("/opt/linkedin/dist/cli", "..", "mcp", "cli.js");
    expect(host.serverLaunch("/home/ada/.config/linkedin/.env")).toEqual({
      command: ["/usr/bin/node", script],
      env: {},
    });
    expect(host.serverLaunch("/work/other.env")).toEqual({
      command: ["/usr/bin/node", script],
      env: { LINKEDIN_CONFIG: "/work/other.env" },
    });
  });

  it("is the only host outside WSL", async () => {
    const { deps } = fakeHostDeps(() => missing);
    const { hosts } = await detectHosts(deps, { HOME: "/home/ada" });
    expect(hosts.map((host) => host.id)).toEqual(["native"]);
  });
});

const WIN_HOME = "C:\\Users\\João O'Brien";
const LINUX_HOME = "/mnt/c/Users/João O'Brien";
const CLAUDE_EXE = `${WIN_HOME}\\.local\\bin\\claude.exe`;
const CODEX_CMD = `${WIN_HOME}\\AppData\\Roaming\\npm\\codex.cmd`;

/** A fake Windows seen from WSL: PowerShell answers the probe and runs .cmd shims, wslpath converts. */
function fakeWindows(overrides: { probe?: ExecResult; powershell?: string; wslpath?: ExecResult } = {}) {
  const scripts: string[] = [];
  const { deps, calls } = fakeHostDeps(
    ({ command, args }) => {
      if (command === (overrides.powershell ?? "powershell.exe")) {
        const script = decodePowerShell(args[args.indexOf("-EncodedCommand") + 1]);
        scripts.push(script);
        if (script.includes("ConvertTo-Json")) {
          return (
            overrides.probe ??
            ok(
              `\uFEFF${JSON.stringify({ home: WIN_HOME, bins: { claude: CLAUDE_EXE, codex: CODEX_CMD, opencode: null } })}`
            )
          );
        }
        if (script.includes(psQuote(cmdCommandLine(CODEX_CMD, ["--version"])))) return ok("codex-cli 0.46.0\r\n");
        return ok("");
      }
      if (command === "wslpath" && overrides.wslpath) return overrides.wslpath;
      if (command === "wslpath") return ok(`${args[1].replace("C:\\", "/mnt/c/").replace(/\\/g, "/")}\n`);
      if (command === `${LINUX_HOME}/.local/bin/claude.exe` && args[0] === "--version")
        return ok("2.1.280 (Claude Code)\r\n");
      return missing;
    },
    { isWsl: () => true }
  );
  return { deps, calls, scripts };
}

const WSL_ENV = { HOME: "/home/ada", WSL_DISTRO_NAME: "Ubuntu" };

describe("psQuote", () => {
  it("single-quotes and doubles embedded quotes", () => {
    expect(psQuote("C:\\Users\\O'Brien\\x.cmd")).toBe("'C:\\Users\\O''Brien\\x.cmd'");
  });
});

describe("cmdCommandLine", () => {
  it("quotes every argument and caret-escapes cmd.exe's metacharacters twice, for npm's %* shims", () => {
    expect(cmdCommandLine("C:\\a b\\x.cmd", ["a&b", "50%", 'say "hi"', "tr\\"])).toBe(
      '/d /s /c "C:\\a^ b\\x.cmd ^^^"a^^^&b^^^" ^^^"50^^^%^^^" ^^^"say^^^ \\^^^"hi\\^^^"^^^" ^^^"tr\\\\^^^""'
    );
  });
});

/** The host, or a failure naming the unreachable reason. */
async function reachable(deps: McpDeps, env: Record<string, string | undefined>) {
  const reach = await windowsHost(deps, env);
  if (!("host" in reach)) throw new Error(`unreachable: ${reach.unreachable}`);
  return reach.host;
}

describe("windowsHost", () => {
  it("reads the Windows home as UTF-8 and exposes it through its env", async () => {
    const { deps } = fakeWindows();
    const host = await reachable(deps, WSL_ENV);
    expect(host?.env).toEqual({ HOME: LINUX_HOME });
    expect(host?.label).toBe("Windows");
    expect(host?.qualifier).toBe("@windows");
  });

  it("runs an .exe through interop and a .cmd through encoded PowerShell", async () => {
    const { deps, scripts } = fakeWindows();
    const host = await reachable(deps, WSL_ENV);
    await expect(host.find("claude")).resolves.toEqual({
      command: `${LINUX_HOME}/.local/bin/claude.exe`,
      version: "2.1.280 (Claude Code)",
    });
    await expect(host.find("codex")).resolves.toEqual({ command: CODEX_CMD, version: "codex-cli 0.46.0" });
    await expect(host.find("opencode")).resolves.toBeUndefined();

    await host.exec(CODEX_CMD, ["mcp", "add", "plane", "--", "wsl.exe", "it's & more"]);
    const script = scripts[scripts.length - 1];
    // cmd.exe gets a command line built here, not by PowerShell 5.1, which leaves & ^ | % bare.
    expect(script).toContain(
      `$info.Arguments = ${psQuote(cmdCommandLine(CODEX_CMD, ["mcp", "add", "plane", "--", "wsl.exe", "it's & more"]))}`
    );
    // A .cmd that cannot even start fails: `exit $LASTEXITCODE` would have exited 0 with it unset.
    expect(script).toContain("exit $child.ExitCode");
    expect(script).toMatch(/catch \{[^}]*exit 1 \}/);
    expect(script).not.toContain("$LASTEXITCODE");
  });

  it("falls back to powershell.exe's absolute path when it is not on the WSL PATH", async () => {
    const { deps, calls } = fakeWindows({ powershell: POWERSHELL_FALLBACK });
    const host = await reachable(deps, WSL_ENV);
    await expect(host.find("codex")).resolves.toEqual({ command: CODEX_CMD, version: "codex-cli 0.46.0" });
    expect(calls.map((call) => call.command).filter((command) => command.includes("owershell"))).toEqual([
      "powershell.exe",
      POWERSHELL_FALLBACK,
      POWERSHELL_FALLBACK,
    ]);
  });

  it("launches the server through wsl.exe with Linux paths, LINKEDIN_CONFIG only for a non-default file", async () => {
    const { deps } = fakeWindows();
    const host = await reachable(deps, WSL_ENV);
    const base = ["wsl.exe", "-d", "Ubuntu", "-e"];
    expect(host.serverLaunch("/home/ada/.config/linkedin/.env")).toEqual({
      command: [...base, "/usr/bin/node", "/opt/linkedin/dist/mcp/cli.js"],
      env: {},
    });
    expect(host.serverLaunch("/work/other.env")).toEqual({
      command: [...base, "env", "LINKEDIN_CONFIG=/work/other.env", "/usr/bin/node", "/opt/linkedin/dist/mcp/cli.js"],
      env: {},
    });
  });

  it("passes LINKEDIN_CONFIG when the default only holds in this shell, since wsl.exe -e sets no XDG_CONFIG_HOME", async () => {
    const { deps } = fakeWindows();
    const host = await reachable(deps, { ...WSL_ENV, XDG_CONFIG_HOME: "/home/ada/.cfg" });
    expect(host.serverLaunch("/home/ada/.cfg/plane/.env").command).toEqual([
      "wsl.exe",
      "-d",
      "Ubuntu",
      "-e",
      "env",
      "LINKEDIN_CONFIG=/home/ada/.cfg/plane/.env",
      "/usr/bin/node",
      "/opt/linkedin/dist/mcp/cli.js",
    ]);
  });

  it("is unreachable, without throwing, naming the probe that failed", async () => {
    const reason = async (deps: McpDeps, env: Record<string, string | undefined> = WSL_ENV) => {
      const reach = await windowsHost(deps, env);
      return "unreachable" in reach ? reach.unreachable : "reachable";
    };
    expect(await reason(fakeHostDeps(() => missing).deps)).toMatch(/not WSL/);
    expect(await reason(fakeWindows().deps, { HOME: "/home/ada" })).toMatch(/WSL_DISTRO_NAME is not set/);
    expect(await reason(fakeWindows({ powershell: "none" }).deps)).toMatch(
      /powershell\.exe is neither on the PATH nor at \/mnt\/c\/Windows/
    );
    expect(await reason(fakeWindows({ probe: { code: 1, stdout: "", stderr: "#< CLIXML" } }).deps)).toBe(
      "powershell.exe exited with code 1"
    );
    expect(await reason(fakeWindows({ probe: { code: 124, stdout: "", stderr: "" } }).deps)).toBe(
      `powershell.exe did not answer within ${FIND_TIMEOUT_MS / 1000}s`
    );
    expect(await reason(fakeWindows({ probe: ok("not json") }).deps)).toMatch(/probe answered something other/);
    expect(await reason(fakeWindows({ wslpath: { code: 1, stdout: "", stderr: "wslpath: bad\n" } }).deps)).toBe(
      `wslpath -u '${WIN_HOME}' failed: wslpath: bad`
    );
  });

  it("joins the native host inside WSL, and says why it did not outside", async () => {
    const inside = await detectHosts(fakeWindows().deps, WSL_ENV);
    expect(inside.hosts.map((host) => host.id)).toEqual(["native", "windows"]);
    expect(inside.windowsUnreachable).toBeUndefined();
    const outside = await detectHosts(fakeHostDeps(() => missing).deps, WSL_ENV);
    expect(outside.windowsUnreachable).toMatch(/not WSL/);
  });
});
