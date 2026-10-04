import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { LinkedInConnection } from "../config";
import { errorResult } from "../errors";

/** What every tool module needs. */
export interface ToolContext {
  connection: LinkedInConnection;
}

/** Reads only what this package saved locally. */
export const LOCAL_READ = { readOnlyHint: true, openWorldHint: false } as const;
export const READ = { readOnlyHint: true, openWorldHint: true } as const;
export const PUBLISH = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;
export const OVERWRITE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

/** Runs a tool body, answering its result as JSON text or its error as text the model can act on. */
export async function run(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await work(), null, 2) }] };
  } catch (error) {
    return errorResult(error);
  }
}
