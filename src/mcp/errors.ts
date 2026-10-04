import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  LinkedInApiError,
  LinkedInAuthError,
  LinkedInConfigError,
  LinkedInMediaError,
  LinkedInTimeoutError,
} from "../errors";

/** A tool input the server refuses before calling LinkedIn. */
export class ToolInputError extends Error {
  override readonly name = "ToolInputError";
}

/** What to do about a status the model cannot fix by changing arguments. */
function hintFor(error: LinkedInApiError): string {
  if (error.status === 403) {
    return (
      " (the token lacks a permission: the LinkedIn app needs the 'Share on LinkedIn' and 'Sign In with LinkedIn " +
      "using OpenID Connect' products, and the post must be the signed-in member's own)"
    );
  }
  if (error.status === 404) return " (no such post: it may have been deleted already, or the URN is wrong)";
  if (error.status === 429) return " (rate limited: LinkedIn allows 150 posts a day per member; try again later)";
  if (error.status === 426 || /version/i.test(error.message)) {
    return " (the LinkedIn-Version may be retired: set a newer LINKEDIN_API_VERSION with `linkedin mcp config`)";
  }
  return "";
}

/** A thrown error as text the model can act on. */
export function describeError(error: unknown): string {
  if (error instanceof LinkedInApiError) return `LinkedIn answered ${error.status}${hintFor(error)}: ${error.message}`;
  if (error instanceof LinkedInAuthError) return error.message.charAt(0).toUpperCase() + error.message.slice(1);
  if (error instanceof LinkedInTimeoutError) return `${error.message} (LinkedIn is slow; try again)`;
  if (error instanceof LinkedInConfigError || error instanceof LinkedInMediaError || error instanceof ToolInputError) {
    return error.message;
  }
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    return `Could not reach LinkedIn: ${cause ?? error.message}`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function errorResult(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: describeError(error) }] };
}
