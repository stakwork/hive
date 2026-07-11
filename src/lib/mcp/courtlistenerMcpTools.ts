/**
 * Thin MCP adapter wrappers for the three CourtListener executor functions.
 *
 * Responsibilities:
 * - Delegate to the shared executors in `courtlistenerTools.ts`.
 * - Convert the `T | string` return union into a proper McpToolResult:
 *     success → mcpOk (JSON-stringified)
 *     string  → mcpError with isError: true
 * - Sanitize the in-app 429 message ("stop all CourtListener calls for this
 *   turn") to a client-neutral form at this boundary only — clFetch's original
 *   message is intentionally left unchanged so the in-app agent's turn-stop
 *   behavior in askToolsMulti.ts is unaffected.
 */
import {
  verifyCitations,
  searchCaseLaw,
  getCases,
} from "@/lib/ai/courtlistenerTools";
import { mcpOk, mcpError, type McpToolResult } from "@/lib/mcp/mcpTools";

const RATE_LIMIT_INTERNAL = "stop all CourtListener calls for this turn";
const RATE_LIMIT_EXTERNAL = "CourtListener rate-limited — please retry later";

function sanitize429(msg: string): string {
  return msg.includes(RATE_LIMIT_INTERNAL)
    ? msg.replace(RATE_LIMIT_INTERNAL, RATE_LIMIT_EXTERNAL)
    : msg;
}

function resultOrError(result: unknown): McpToolResult {
  if (typeof result === "string") {
    return mcpError(sanitize429(result));
  }
  return mcpOk(result);
}

export async function mcpVerifyCitations(args: {
  citations: string[];
}): Promise<McpToolResult> {
  const result = await verifyCitations(args);
  return resultOrError(result);
}

export async function mcpSearchCaseLaw(args: {
  query: string;
  court?: string;
  filedAfter?: string;
  filedBefore?: string;
  limit: number;
}): Promise<McpToolResult> {
  const result = await searchCaseLaw(args);
  return resultOrError(result);
}

export async function mcpGetCases(args: {
  clusterIds: number[];
  includeFullText: boolean;
  maxChars: number;
}): Promise<McpToolResult> {
  const result = await getCases(args);
  return resultOrError(result);
}
