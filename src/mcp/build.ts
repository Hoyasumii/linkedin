import * as fs from "node:fs";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LinkedInConnection } from "./config";
import { registerPostTools } from "./tools/posts";

export const SERVER_NAME = "linkedin";
/** The package's own version, read at runtime: `src/mcp/` and `dist/mcp/` both sit two levels below `package.json`. */
const PACKAGE_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")) as {
  version: string;
  homepage: string;
};
export const SERVER_VERSION = PACKAGE_JSON.version;
/** The documentation site, the package's `homepage`. */
export const DOCS_URL = PACKAGE_JSON.homepage;

/**
 * An MCP server that posts on the signed-in member's LinkedIn profile, with no transport attached.
 *
 * It creates, edits and deletes the member's posts, and lists the ones made through it (LinkedIn
 * does not let ordinary apps read posts back). Connect it to any transport —
 * {@link serveLinkedInMcpStdio} serves it over stdio.
 */
export function buildLinkedInMcpServer(connection: LinkedInConnection): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Posts on the signed-in member's LinkedIn profile. linkedin_create_post publishes at once (text, plus " +
        "images, a video, a document or an article link), linkedin_edit_post replaces a post's text, " +
        "linkedin_delete_post deletes one (confirm: true, after the user agreed). LinkedIn does not let this server " +
        "read posts: linkedin_list_posts and linkedin_get_post know only the posts made or edited here, so for any " +
        "other post ask the user for its URN or URL. Write plain text: reserved characters are escaped for you. " +
        "Publish only what the user asked for, and show them text you wrote before posting it. If a tool says the " +
        "member is not signed in, tell the user to run `linkedin mcp config --web`.",
    }
  );
  registerPostTools(server, { connection });
  return server;
}
