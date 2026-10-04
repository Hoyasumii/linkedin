import { CommandDef, defineCommand, renderUsage, runCommand } from "citty";
import {
  type Credentials,
  credentialsPath,
  deleteCredentials,
  isExpired,
  readCredentials,
} from "../../auth/credentials";
import {
  DEFAULT_REDIRECT_PORT,
  ConfigValues,
  configFilePath,
  readEnvFile,
  redirectUri,
  writeEnvFile,
} from "../../mcp/config";
import { CliInputError, type CliIo } from "../run";
import { signedInLine } from "./config-page";
import { promptConfig } from "./config-prompt";
import {
  CONFIG_UI_TIMEOUT_MS,
  type LoginUi,
  type LoginUiOptions,
  configValueError,
  startLoginUi,
  valuesFromInput,
} from "./config-ui";
import { McpDeps } from "./deps";
import { detectHosts } from "./hosts";
import {
  CLIENTS,
  ClientStatus,
  SERVER_ENTRY,
  detectClients,
  displayName,
  flagId,
  formatAction,
  formatStep,
  installSteps,
  runSteps,
  runUninstall,
  uninstallActions,
} from "./install";
import { multiSelect } from "./picker";

/** `linkedin mcp status` exits with this when nobody is signed in, or the sign-in expired. */
export const EXIT_NOT_SIGNED_IN = 3;

/** `linkedin mcp install`/`uninstall`/`config` exit with this when a prompt is cancelled (as a shell does on Ctrl+C). */
export const EXIT_CANCELLED = 130;

function configFileOf(io: CliIo, deps: McpDeps, override: string | undefined): string {
  return configFilePath(override ? { ...io.env, LINKEDIN_CONFIG: override } : io.env, deps.platform);
}

/**
 * The saved sign-in, refusing when `linkedin mcp config` has not signed anyone in yet: the server
 * `linkedin mcp install` registers would answer every call with "not signed in".
 */
export function requireSignedIn(configFile: string): Credentials {
  const credentials = readCredentials(credentialsPath(configFile));
  if (!credentials) {
    throw new CliInputError(
      `Not signed in to LinkedIn (no ${credentialsPath(configFile)}): run \`linkedin mcp config --web\` first.`
    );
  }
  return credentials;
}

/** `--client`'s ids, for its help: every client, bare, and then the WSL bridge's. */
const CLIENT_FLAG_IDS = `${CLIENTS.map((client) => client.id).join(", ")}; inside WSL also ${CLIENTS.map(
  (client) => `${client.id}@windows`
).join(", ")}`;

const configArg = {
  config: {
    type: "string",
    description: "The saved .env to read (env LINKEDIN_CONFIG). Default: per-user config dir.",
  },
} as const;

/** How a client on this host is reached, appended to its picker hint. */
function hostHint(client: ClientStatus): string {
  return client.host.id === "windows" ? " · via wsl.exe" : "";
}

function installHint(client: ClientStatus): string {
  if (!client.installed) return "not found";
  return client.entry
    ? `${client.version}${hostHint(client)} · already installed, reinstalls`
    : `${client.version ?? ""}${hostHint(client)}`;
}

function uninstallHint(client: ClientStatus): string {
  if (!client.installed) return "not found";
  return client.entry
    ? `${client.version}${hostHint(client)} · ${client.entry.transport}`
    : `no '${SERVER_ENTRY}' entry`;
}

/** The clients `--client` names, each installed; `check` refuses one the command cannot act on. */
function clientsFromFlag(
  value: string,
  statuses: ClientStatus[],
  windowsUnreachable: string | undefined,
  check: (client: ClientStatus) => void
): ClientStatus[] {
  const ids = value
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  const known = [...new Set(statuses.map(flagId))].join(", ");
  if (ids.length === 0) throw new CliInputError(`--client needs at least one of: ${known}.`);
  return [...new Set(ids)].map((id) => {
    const status = statuses.find((client) => flagId(client) === id);
    if (!status && id.endsWith("@windows") && windowsUnreachable) {
      throw new CliInputError(
        `'${id}' needs the Windows side reachable from WSL, and it is not: ${windowsUnreachable}.`
      );
    }
    if (!status) throw new CliInputError(`Unknown client '${id}'. Known clients: ${known}.`);
    if (!status.installed)
      throw new CliInputError(`${displayName(status)} was not found (\`${status.bin} --version\` failed).`);
    check(status);
    return status;
  });
}

/**
 * The clients to act on: from `--client` when given, otherwise from the picker, which needs an
 * interactive terminal. `undefined` when the picker was cancelled.
 */
async function chooseClients(
  deps: McpDeps,
  { statuses, windowsUnreachable }: { statuses: ClientStatus[]; windowsUnreachable?: string },
  flag: unknown,
  picker: {
    message: string;
    hint(client: ClientStatus): string;
    enabled(client: ClientStatus): boolean;
    checked(client: ClientStatus): boolean;
    none: string;
  },
  check: (client: ClientStatus) => void,
  noTerminal: (ids: string) => string
): Promise<ClientStatus[] | undefined> {
  if (flag !== undefined) return clientsFromFlag(String(flag), statuses, windowsUnreachable, check);
  if (!deps.terminal) throw new CliInputError(noTerminal([...new Set(statuses.map(flagId))].join(",")));
  if (!statuses.some(picker.enabled)) throw new CliInputError(picker.none);
  const picked = await multiSelect(
    picker.message,
    statuses.map((client) => ({
      label: displayName(client),
      hint: picker.hint(client),
      disabled: !picker.enabled(client),
      checked: picker.enabled(client) && picker.checked(client),
    })),
    deps.terminal
  );
  return picked?.map((index) => statuses[index]);
}

/** For tests: the login server's endpoints and timeout. */
export type LoginOverrides = Omit<LoginUiOptions, "port">;

function buildMcpCommand(io: CliIo, deps: McpDeps, exit: { code: number }, login: LoginOverrides): CommandDef {
  /** Serves the sign-in, opens it in the browser, and waits for LinkedIn's redirect. */
  const signIn = async (configFile: string, saved: ConfigValues, web: boolean, open: boolean): Promise<void> => {
    const port = Number(saved.LINKEDIN_REDIRECT_PORT ?? DEFAULT_REDIRECT_PORT);
    const ui: LoginUi = await startLoginUi(configFile, { ...login, port });
    const url = web ? ui.formUrl : ui.loginUrl;
    io.stdout(
      [
        web ? `Settings and sign-in: ${url}` : `Sign in to LinkedIn: ${url}`,
        `(LinkedIn sends you back to ${redirectUri(port)}, which the app must list as an Authorized redirect URL.)`,
        "Waiting for the sign-in (Ctrl+C to cancel)…",
      ].join("\n")
    );
    if (open) deps.openBrowser(url).catch(() => io.stderr("Could not open a browser; open the link above."));
    try {
      const outcome = await ui.done;
      if (outcome.kind === "timeout") {
        io.stderr(`Nobody signed in within ${Math.round((login.timeoutMs ?? CONFIG_UI_TIMEOUT_MS) / 60_000)} minutes.`);
        exit.code = 1;
        return;
      }
      io.stdout(signedInLine(outcome.credentials));
      io.stdout("Register the server in your AI clients, if not done yet: linkedin mcp install");
    } finally {
      await ui.close();
    }
  };

  const config = defineCommand({
    meta: {
      name: "config",
      description:
        "Save your LinkedIn app's Client ID and Secret and sign in: in a local web page (--web, recommended), " +
        "or asked in the terminal (or set by flags) and then signed in in the browser.",
    },
    args: {
      ...configArg,
      web: { type: "boolean", description: "Do it all in a local web page, with the app setup steps." },
      "client-id": { type: "string", description: "Save this Client ID, without asking." },
      "client-secret": {
        type: "string",
        description: "Save this Client Secret, without asking. It stays in your shell history; prefer the prompt.",
      },
      "redirect-port": {
        type: "string",
        description: `Save this redirect port ('' resets it to ${DEFAULT_REDIRECT_PORT}); the app must list http://localhost:<port>/callback.`,
      },
      "api-version": { type: "string", description: "Save this LinkedIn-Version, YYYYMM ('' resets it)." },
      login: {
        type: "boolean",
        default: true,
        description: "Sign in after saving (--no-login only saves the settings).",
      },
      open: { type: "boolean", default: true, description: "Open the page in the browser (--no-open to skip)." },
    },
    async run({ args }) {
      const configFile = configFileOf(io, deps, args.config);
      const flags: ConfigValues = {
        LINKEDIN_CLIENT_ID: args["client-id"],
        LINKEDIN_CLIENT_SECRET: args["client-secret"],
        LINKEDIN_REDIRECT_PORT: args["redirect-port"],
        LINKEDIN_API_VERSION: args["api-version"],
      };
      const given = (Object.keys(flags) as (keyof ConfigValues)[]).filter((key) => flags[key] !== undefined);
      const saved = readEnvFile(configFile);

      if (args.web) {
        if (given.some((key) => key !== "LINKEDIN_REDIRECT_PORT")) {
          throw new CliInputError("--web takes no values but --redirect-port: set them in the page.");
        }
        const port = args["redirect-port"]?.trim();
        if (port !== undefined) {
          const error = port ? configValueError("LINKEDIN_REDIRECT_PORT", port) : undefined;
          if (error) throw new CliInputError(error);
          writeEnvFile(configFile, { ...saved, LINKEDIN_REDIRECT_PORT: port || undefined });
        }
        await signIn(configFile, readEnvFile(configFile), true, args.open);
        return;
      }

      let input: ConfigValues | undefined;
      if (given.length > 0) {
        // Only the flags given change anything: the rest is kept as saved (the secret through
        // valuesFromInput's blank-keeps rule, so it is not passed back in as input).
        input = { ...saved, LINKEDIN_CLIENT_SECRET: undefined };
        for (const key of given) input[key] = flags[key];
      } else if (saved.LINKEDIN_CLIENT_ID && saved.LINKEDIN_CLIENT_SECRET && !deps.terminal) {
        input = { ...saved, LINKEDIN_CLIENT_SECRET: undefined };
      } else {
        if (!deps.terminal) {
          throw new CliInputError(
            "No interactive terminal to ask in: use --web, or pass --client-id and --client-secret."
          );
        }
        io.stdout(`Configuring ${configFile}`);
        input = await promptConfig(saved, deps.terminal);
        if (!input) {
          io.stderr("Nothing was saved.");
          exit.code = EXIT_CANCELLED;
          return;
        }
      }
      const { values, error } = valuesFromInput(input, saved);
      if (error) throw new CliInputError(error);
      writeEnvFile(configFile, values);
      io.stdout(`Saved ${configFile}.`);
      if (args.login) await signIn(configFile, values, false, args.open);
    },
  });

  const status = defineCommand({
    meta: {
      name: "status",
      description: `Who is signed in and until when (exit ${EXIT_NOT_SIGNED_IN} if nobody, or the sign-in expired).`,
    },
    args: configArg,
    async run({ args }) {
      const configFile = configFileOf(io, deps, args.config);
      const saved = readEnvFile(configFile);
      const credentials = readCredentials(credentialsPath(configFile));
      const port = Number(saved.LINKEDIN_REDIRECT_PORT ?? DEFAULT_REDIRECT_PORT);
      io.stdout(
        [
          `sign-in     ${signedInLine(credentials)}`,
          `app         ${saved.LINKEDIN_CLIENT_ID ? `Client ID ${saved.LINKEDIN_CLIENT_ID}` : "not configured"}`,
          `redirect    ${redirectUri(port)}`,
          `config      ${configFile}`,
        ].join("\n")
      );
      if (!credentials || isExpired(credentials)) exit.code = EXIT_NOT_SIGNED_IN;
    },
  });

  const logout = defineCommand({
    meta: {
      name: "logout",
      description:
        "Forget the LinkedIn sign-in on this computer (the app settings stay). To revoke the app's access too, " +
        "remove it at linkedin.com/psettings/permitted-services.",
    },
    args: configArg,
    async run({ args }) {
      const file = credentialsPath(configFileOf(io, deps, args.config));
      io.stdout(deleteCredentials(file) ? `Signed out: removed ${file}.` : "Nobody was signed in.");
    },
  });

  const install = defineCommand({
    meta: {
      name: "install",
      description:
        "Register the LinkedIn MCP server (stdio) in Claude Code, Codex or OpenCode, picked from a list. " +
        "Needs a sign-in (`linkedin mcp config --web`), which the registered server reads on every call.",
    },
    args: {
      client: {
        type: "string",
        description: `Skip the picker: comma-separated clients to install into (${CLIENT_FLAG_IDS}).`,
      },
      force: { type: "boolean", description: `With --client: replace an existing '${SERVER_ENTRY}' entry.` },
      "dry-run": { type: "boolean", description: "Print the commands instead of running them." },
      ...configArg,
    },
    async run({ args }) {
      const configFile = configFileOf(io, deps, args.config);
      requireSignedIn(configFile);
      const detected = await detectHosts(deps, io.env);
      const statuses = await detectClients(detected.hosts);
      const searched = CLIENTS.map((client) => client.name).join(", ");

      const chosen = await chooseClients(
        deps,
        { statuses, windowsUnreachable: detected.windowsUnreachable },
        args.client,
        {
          message: "Install the LinkedIn MCP server (stdio) into:",
          hint: installHint,
          enabled: (client) => client.installed,
          checked: () => true,
          none: `None of ${searched} was found on the PATH.`,
        },
        (client) => {
          if (client.entry && !args.force) {
            throw new CliInputError(
              `${displayName(client)} already has an MCP server named '${SERVER_ENTRY}'; pass --force to replace it.`
            );
          }
        },
        (ids) => `No interactive terminal for the picker: pass --client ${ids} (and --force to replace an entry).`
      );
      if (!chosen) {
        exit.code = EXIT_CANCELLED;
        return;
      }

      const width = Math.max(...chosen.map((client) => displayName(client).length));
      for (const client of chosen) {
        const steps = installSteps(client, client.host.serverLaunch(configFile), Boolean(client.entry));
        const label = displayName(client).padEnd(width);
        if (args["dry-run"]) {
          io.stdout(`${label}  would run:\n${steps.map((step) => `  ${formatStep(step)}`).join("\n")}`);
          continue;
        }
        const outcome = await runSteps(client.host, steps);
        if (outcome.ok) {
          io.stdout(`✔ ${label}  registered as '${SERVER_ENTRY}'${client.entry ? " (replaced)" : ""}`);
        } else {
          io.stderr(`✘ ${label}  ${outcome.detail}`);
          exit.code = 1;
        }
      }
      if (!args["dry-run"] && exit.code === 0) {
        io.stdout("Restart the client, or reconnect its MCP servers, to load it.");
      }
    },
  });

  const uninstall = defineCommand({
    meta: {
      name: "uninstall",
      description:
        `Remove the '${SERVER_ENTRY}' MCP server from Claude Code, Codex or OpenCode, picked from a list. ` +
        "Runs without a sign-in, so a client can be cleaned up after it is gone.",
    },
    args: {
      client: {
        type: "string",
        description: `Skip the picker: comma-separated clients to remove it from (${CLIENT_FLAG_IDS}).`,
      },
      "dry-run": { type: "boolean", description: "Print what would be removed instead of removing it." },
    },
    async run({ args }) {
      const detected = await detectHosts(deps, io.env);
      const statuses = await detectClients(detected.hosts);
      const chosen = await chooseClients(
        deps,
        { statuses, windowsUnreachable: detected.windowsUnreachable },
        args.client,
        {
          message: "Remove the LinkedIn MCP server from:",
          hint: uninstallHint,
          enabled: (client) => Boolean(client.entry),
          checked: () => true,
          none: `No client has an MCP server named '${SERVER_ENTRY}' in its user config.`,
        },
        (client) => {
          if (!client.entry)
            throw new CliInputError(`${displayName(client)} has no MCP server named '${SERVER_ENTRY}'.`);
        },
        (ids) => `No interactive terminal for the picker: pass --client ${ids}.`
      );
      if (!chosen) {
        exit.code = EXIT_CANCELLED;
        return;
      }

      const width = Math.max(...chosen.map((client) => displayName(client).length));
      for (const client of chosen) {
        const actions = uninstallActions(client);
        const label = displayName(client).padEnd(width);
        if (args["dry-run"]) {
          io.stdout(`${label}  would:\n${actions.map((action) => `  ${formatAction(action)}`).join("\n")}`);
          continue;
        }
        const outcome = await runUninstall(client.host, actions);
        if (outcome.ok) {
          io.stdout(`✔ ${label}  removed '${SERVER_ENTRY}'`);
        } else {
          io.stderr(`✘ ${label}  ${outcome.detail}`);
          exit.code = 1;
        }
      }
      if (!args["dry-run"] && exit.code === 0) {
        io.stdout("Restart the client, or reconnect its MCP servers, to drop it.");
      }
    },
  });

  return defineCommand({
    meta: { name: "mcp", description: "Sign in to LinkedIn and register the LinkedIn MCP server in your AI clients." },
    subCommands: { config, status, logout, install, uninstall },
  });
}

/** The deepest subcommand the arguments name, for usage output. */
async function usageFor(main: CommandDef, argv: string[]): Promise<string> {
  let command = main;
  let parent: CommandDef | undefined;
  for (const arg of argv) {
    if (arg.startsWith("-")) continue;
    const next = ((command.subCommands ?? {}) as Record<string, CommandDef>)[arg];
    if (!next) break;
    parent = command;
    command = next;
  }
  return renderUsage(command, parent);
}

/** `linkedin mcp …`: answers the exit code. */
export async function runMcpCli(argv: string[], io: CliIo, deps: McpDeps, login: LoginOverrides = {}): Promise<number> {
  const exit = { code: 0 };
  const main = buildMcpCommand(io, deps, exit, login);
  if (argv.includes("--help") || argv.includes("-h") || argv.filter((arg) => !arg.startsWith("-")).length === 0) {
    io.stdout(await usageFor(main, argv));
    return 0;
  }
  try {
    await runCommand(main, { rawArgs: argv });
    return exit.code;
  } catch (error) {
    if (error instanceof Error && error.name === "CLIError") {
      io.stderr(`${await usageFor(main, argv)}\n\n${error.message}`);
      return 1;
    }
    throw error;
  }
}
