import * as path from "node:path";
import { configFilePath } from "../../mcp/config";
import { ExecResult, McpDeps } from "./deps";

type Env = Record<string, string | undefined>;

/** A client that does not answer `--version` within this is treated as not installed. */
export const FIND_TIMEOUT_MS = 10_000;

/** What a client runs to start `linkedin-mcp` over stdio, plus the env it needs. */
export interface ServerLaunch {
  command: string[];
  env: Record<string, string>;
}

/** A client CLI a host found: how to run it, and the first line of its `--version`. */
export interface FoundClient {
  command: string;
  version: string;
}

/** Where clients live, and how to reach them from this process. */
export interface ClientHost {
  id: "native" | "windows";
  /** Shown after a client's name in the picker, `Claude Code (Windows)`; "" for native. */
  label: string;
  /** Appended to a client id in `--client`, `claude@windows`; "" for native. */
  qualifier: string;
  /** The environment the entry readers resolve config paths from: HOME and the clients' own overrides. */
  env: Env;
  /** Locate a client CLI and read its version; `undefined` when it is absent or does not answer. */
  find(bin: string): Promise<FoundClient | undefined>;
  /** Run a found client's CLI; same contract as `McpDeps.exec`. */
  exec(command: string, args: string[]): Promise<ExecResult>;
  /** The command a client on this host runs to start `linkedin-mcp` over stdio. */
  serverLaunch(configFile: string): ServerLaunch;
}

export function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0] ?? "";
}

/** `LINKEDIN_CONFIG`, only when `configFile` is not the default one: `linkedin-mcp` finds that by itself. */
export function configEnv(deps: McpDeps, env: Env, configFile: string): Record<string, string> {
  const { LINKEDIN_CONFIG: _override, ...withoutOverride } = env;
  return configFilePath(withoutOverride, deps.platform) === configFile ? {} : { LINKEDIN_CONFIG: configFile };
}

/**
 * This platform: clients are on the PATH, and launch `node <dist>/mcp/cli.js` by absolute path,
 * so they do not depend on the PATH they hand their servers.
 */
export function nativeHost(deps: McpDeps, env: Env): ClientHost {
  return {
    id: "native",
    label: "",
    qualifier: "",
    env,
    async find(bin) {
      const result = await deps.exec(bin, ["--version"], { timeoutMs: FIND_TIMEOUT_MS });
      return result.code === 0 ? { command: bin, version: firstLine(result.stdout) } : undefined;
    },
    exec: (command, args) => deps.exec(command, args),
    serverLaunch(configFile) {
      const script = path.join(path.dirname(deps.cliEntry), "..", "mcp", "cli.js");
      return { command: [deps.nodePath, script], env: configEnv(deps, env, configFile) };
    },
  };
}

/** The hosts found, and, when Windows is not among them, why. */
export interface DetectedHosts {
  hosts: ClientHost[];
  windowsUnreachable?: string;
}

/** The hosts to look for clients in: this platform, plus Windows when running inside WSL. */
export async function detectHosts(deps: McpDeps, env: Env): Promise<DetectedHosts> {
  const windows = await windowsHost(deps, env);
  return "host" in windows
    ? { hosts: [nativeHost(deps, env), windows.host] }
    : { hosts: [nativeHost(deps, env)], windowsUnreachable: windows.unreachable };
}

/** The client CLIs the Windows probe looks for. */
export const CLIENT_BINS = ["claude", "codex", "opencode"] as const;

/** What the probe script answers: USERPROFILE, and the Windows path of each client CLI (or null). */
export interface WindowsProbe {
  home: string;
  bins: Record<string, string | null>;
}

const UTF8_OUTPUT = "[Console]::OutputEncoding = [Text.Encoding]::UTF8";

/**
 * PowerShell 5.1 that answers `{ home, bins }` as one line of JSON. It reads the user's and the
 * machine's `Path` from the registry (a `cmd.exe` started from WSL sees only system32), adds the
 * native installer's `.local\bin` and npm's global dir, and looks for `<bin>.exe`, then `<bin>.cmd`.
 */
export function windowsProbeScript(bins: readonly string[]): string {
  return [
    "$dirs = @()",
    "foreach ($scope in 'User', 'Machine') {",
    "  $value = [Environment]::GetEnvironmentVariable('Path', $scope)",
    "  if ($value) { $dirs += $value -split ';' }",
    "}",
    "$dirs += (Join-Path $env:USERPROFILE '.local\\bin'), (Join-Path $env:APPDATA 'npm')",
    "$found = @{}",
    `foreach ($bin in @(${bins.map(psQuote).join(", ")})) {`,
    "  $found[$bin] = $null",
    "  foreach ($dir in $dirs) {",
    "    if (-not $dir) { continue }",
    "    $dir = [Environment]::ExpandEnvironmentVariables($dir)",
    "    foreach ($ext in '.exe', '.cmd') {",
    "      try { $candidate = [IO.Path]::Combine($dir, $bin + $ext) } catch { continue }",
    "      if ([IO.File]::Exists($candidate)) { $found[$bin] = $candidate; break }",
    "    }",
    "    if ($found[$bin]) { break }",
    "  }",
    "}",
    "@{ home = $env:USERPROFILE; bins = $found } | ConvertTo-Json -Compress",
  ].join("\n");
}

/** A PowerShell single-quoted string: nothing inside is interpreted, and `'` is doubled. */
export function psQuote(arg: string): string {
  return `'${arg.replace(/'/g, "''")}'`;
}

/**
 * The `-EncodedCommand` payload: base64 of UTF-16LE, with a prelude that makes the output UTF-8.
 * Nothing needs quoting across WSL interop, which builds Windows command lines with MSVCRT rules.
 */
export function encodePowerShell(script: string): string {
  return Buffer.from(`${UTF8_OUTPUT}\n${script}`, "utf16le").toString("base64");
}

export function decodePowerShell(encoded: string): string {
  return Buffer.from(encoded, "base64").toString("utf16le");
}

/** Where Windows keeps it, for a WSL whose PATH leaves Windows out (`appendWindowsPath = false`). */
export const POWERSHELL_FALLBACK = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe";

function powershell(deps: McpDeps, command: string, script: string, timeoutMs: number): Promise<ExecResult> {
  return deps.exec(command, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodePowerShell(script)], {
    timeoutMs,
  });
}

/** Either Windows, reached, or the reason it could not be. */
export type WindowsProbeResult = { probe: WindowsProbe; powershell: string } | { unreachable: string };

/** Ask Windows for its home and client CLIs, through `powershell.exe` on the PATH or at its default place. */
export async function probeWindows(deps: McpDeps, env: Env): Promise<WindowsProbeResult> {
  if (!deps.isWsl()) return { unreachable: "this is not WSL (/proc/version does not name Microsoft)" };
  if (!env.WSL_DISTRO_NAME) return { unreachable: "WSL_DISTRO_NAME is not set" };
  const script = windowsProbeScript(CLIENT_BINS);
  let command = "powershell.exe";
  let result = await powershell(deps, command, script, FIND_TIMEOUT_MS);
  if (result.code === 127) {
    command = POWERSHELL_FALLBACK;
    result = await powershell(deps, command, script, FIND_TIMEOUT_MS);
  }
  if (result.code === 127) {
    return {
      unreachable: `powershell.exe is neither on the PATH nor at ${POWERSHELL_FALLBACK} (is WSL interop enabled?)`,
    };
  }
  if (result.code === 124) {
    return { unreachable: `powershell.exe did not answer within ${FIND_TIMEOUT_MS / 1000}s` };
  }
  // Its stderr is CLIXML, not a message worth showing.
  if (result.code !== 0) return { unreachable: `powershell.exe exited with code ${result.code}` };
  try {
    const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, "").trim()) as Partial<WindowsProbe>;
    if (typeof parsed.home === "string" && parsed.bins && typeof parsed.bins === "object") {
      return { probe: { home: parsed.home, bins: parsed.bins }, powershell: command };
    }
  } catch {
    // Answered below.
  }
  return { unreachable: "powershell.exe's probe answered something other than { home, bins } JSON" };
}

async function toLinuxPath(deps: McpDeps, windowsPath: string): Promise<ExecResult> {
  return deps.exec("wslpath", ["-u", windowsPath], { timeoutMs: FIND_TIMEOUT_MS });
}

/** What `cmd.exe` treats specially on its command line: each gets a `^` in front. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * `cmd.exe`'s arguments to run a `.cmd` with `args` intact, escaped the way `cross-spawn` escapes
 * them: MSVCRT quoting, then `^` before every metacharacter — twice, because npm's shims hand
 * `%*` to a second parse. PowerShell 5.1 is not trusted with this: it quotes only arguments with
 * spaces, so `&`, `|`, `^` and `%` reach `cmd.exe` bare.
 */
export function cmdCommandLine(command: string, args: string[]): string {
  const quoted = args.map((arg) => {
    const msvcrt = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
    return msvcrt.replace(CMD_META, "^$1").replace(CMD_META, "^$1");
  });
  return `/d /s /c "${[command.replace(CMD_META, "^$1"), ...quoted].join(" ")}"`;
}

/**
 * PowerShell that runs a `.cmd` through `cmd.exe` with {@link cmdCommandLine}, sharing its own
 * stdio, and exits with the child's code — or 1 when the child could not start, where
 * `$LASTEXITCODE` would have stayed unset and `exit` answered 0. It starts in `USERPROFILE`,
 * since `cmd.exe` refuses the UNC path a WSL working directory maps to.
 */
function runCmdScript(command: string, args: string[]): string {
  return [
    "try {",
    "  $info = New-Object Diagnostics.ProcessStartInfo",
    "  $info.FileName = $env:ComSpec",
    `  $info.Arguments = ${psQuote(cmdCommandLine(command, args))}`,
    "  $info.UseShellExecute = $false",
    "  $info.WorkingDirectory = $env:USERPROFILE",
    "  $child = [Diagnostics.Process]::Start($info)",
    "  $child.WaitForExit()",
    "  exit $child.ExitCode",
    "} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }",
  ].join("\n");
}

const isCmd = (command: string): boolean => /\.(cmd|bat)$/i.test(command);

/**
 * Windows seen from inside WSL. Clients' configs are read under `/mnt/c/Users/<user>`. An `.exe`
 * runs directly through interop; a `.cmd` (npm's shims) runs through encoded PowerShell. A
 * client starts the server with `wsl.exe -d <distro> -e node <dist>/mcp/cli.js`. Outside WSL, or
 * when Windows cannot be reached, it answers why instead.
 */
export async function windowsHost(deps: McpDeps, env: Env): Promise<{ host: ClientHost } | { unreachable: string }> {
  const probed = await probeWindows(deps, env);
  if ("unreachable" in probed) return probed;
  const { probe } = probed;
  const converted = await toLinuxPath(deps, probe.home);
  if (converted.code !== 0) {
    const detail = firstLine(converted.stderr);
    return { unreachable: `wslpath -u '${probe.home}' failed${detail ? `: ${detail}` : ""}` };
  }
  const home = converted.stdout.trim();
  const distro = env.WSL_DISTRO_NAME as string;

  const run = (command: string, args: string[], timeoutMs?: number): Promise<ExecResult> =>
    isCmd(command)
      ? powershell(deps, probed.powershell, runCmdScript(command, args), timeoutMs ?? 120_000)
      : deps.exec(command, args, timeoutMs === undefined ? undefined : { timeoutMs });

  const host: ClientHost = {
    id: "windows",
    label: "Windows",
    qualifier: "@windows",
    env: { HOME: home },
    async find(bin) {
      const located = probe.bins[bin];
      if (!located) return undefined;
      let command = located;
      if (!isCmd(located)) {
        const converted = await toLinuxPath(deps, located);
        if (converted.code !== 0) return undefined;
        command = converted.stdout.trim();
      }
      const result = await run(command, ["--version"], FIND_TIMEOUT_MS);
      return result.code === 0 ? { command, version: firstLine(result.stdout) } : undefined;
    },
    exec: (command, args) => run(command, args),
    serverLaunch(configFile) {
      const script = path.posix.join(path.posix.dirname(deps.cliEntry), "..", "mcp", "cli.js");
      // `wsl.exe -e` runs no login shell: the server sees HOME but none of this shell's
      // XDG_CONFIG_HOME, so "default" is judged by HOME alone.
      const extra = configEnv(deps, { HOME: env.HOME }, configFile);
      const envArgs = extra.LINKEDIN_CONFIG ? ["env", `LINKEDIN_CONFIG=${extra.LINKEDIN_CONFIG}`] : [];
      // Windows env vars do not cross into WSL, so LINKEDIN_CONFIG rides on the command line instead.
      return { command: ["wsl.exe", "-d", distro, "-e", ...envArgs, deps.nodePath, script], env: {} };
    },
  };
  return { host };
}
