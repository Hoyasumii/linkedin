/**
 * `@hoyasumii/linkedin/mcp` — an MCP server over this SDK.
 *
 * `serveLinkedInMcpStdio(connection)` serves it over stdio; `buildLinkedInMcpServer(connection)`
 * gives the bare `McpServer` for any other transport. `connectionFor(resolveMcpConfig(…))` builds the
 * connection from the saved configuration and sign-in.
 */
export { serveLinkedInMcpStdio } from "./stdio";
export type { LinkedInMcpStdioOptions, RunningLinkedInMcpStdio } from "./stdio";
export { buildLinkedInMcpServer, SERVER_NAME, SERVER_VERSION } from "./build";
export {
  CONFIG_KEYS,
  configDir,
  configFilePath,
  connectionFor,
  DEFAULT_REDIRECT_PORT,
  readEnvFile,
  redirectUri,
  resolveMcpConfig,
  writeEnvFile,
} from "./config";
export type { ConfigKey, ConfigValues, ConnectionOverrides, LinkedInConnection, McpConfig } from "./config";
export { describeError, ToolInputError } from "./errors";
