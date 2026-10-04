#!/usr/bin/env node
/**
 * `linkedin`: sign in to LinkedIn and register the LinkedIn MCP server in your AI clients.
 *
 *   linkedin mcp config --web    # create the app's settings and sign in, in the browser
 *   linkedin mcp install         # register linkedin-mcp in Claude Code, Codex or OpenCode
 */
import { runCli } from "./run";

runCli(process.argv.slice(2), {
  // oxlint-disable-next-line no-console -- a CLI's output is the console
  stdout: (text) => console.log(text),
  // oxlint-disable-next-line no-console
  stderr: (text) => console.error(text),
  env: process.env,
}).then((code) => {
  process.exitCode = code;
});
