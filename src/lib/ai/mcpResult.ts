/**
 * Shared helpers for capping MCP tool result payloads before they reach the model.
 *
 * Exports:
 *  - mcpText         — extract text from an McpToolResult
 *  - truncateField   — truncate a single string field with a marker
 *  - capMcpResult    — cap per-field lengths and total payload size
 *  - MCP_FIELD_CHAR_CAP    — default per-field cap (~500 tokens)
 *  - MCP_TOTAL_CHAR_BUDGET — default total payload budget (~6k tokens)
 */

export const MCP_FIELD_CHAR_CAP = 2000;
export const MCP_TOTAL_CHAR_BUDGET = 24000;

type McpContentItem = { type: string; text?: string; [key: string]: unknown };

/** Extract text from an McpToolResult for use as a tool return value. */
export function mcpText(result: { content: { type: string; text: string }[] }): string {
  return result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

/** Resolve an MCP call result (either content-array or toolResult) to a plain string. */
function mcpResultToText(result: unknown): string {
  if (result !== null && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.content)) {
      return (r.content as Array<Record<string, unknown>>)
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("\n");
    }
    if ("toolResult" in r) {
      const tr = r.toolResult;
      return typeof tr === "string" ? tr : JSON.stringify(tr ?? "");
    }
  }
  return "";
}

/** Truncate a string to `cap` chars and append a marker indicating how many chars were cut. */
export function truncateField(value: string, cap: number): string {
  if (value.length <= cap) return value;
  const omitted = value.length - cap;
  return `${value.slice(0, cap)}…[truncated ${omitted} chars]`;
}

/**
 * Cap an MCP tool result before returning it to the model.
 *
 * 1. Extracts text via `mcpText`.
 * 2. Tries to JSON-parse it as an array of hits or `{ hits: [...] }`.
 *    - Truncates every string field on each hit that exceeds `fieldCap`.
 *    - Re-stringifies; if the result still exceeds `totalBudget`, drops
 *      trailing hits until under budget and appends an omitted-count note.
 * 3. If JSON-parse fails (plain string), truncates the whole string to `totalBudget`.
 * 4. Never throws — on any failure falls back to a raw string truncate.
 */
export function capMcpResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any,
  opts?: { fieldCap?: number; totalBudget?: number }
): string {
  const fieldCap = opts?.fieldCap ?? MCP_FIELD_CHAR_CAP;
  const totalBudget = opts?.totalBudget ?? MCP_TOTAL_CHAR_BUDGET;

  let text: string;
  try {
    text = mcpResultToText(result);
  } catch {
    return "";
  }

  try {
    const parsed = JSON.parse(text);

    // Normalise to an array of hits
    let hits: unknown[] | null = null;
    let wrapper: string | null = null; // key name when wrapped in an object

    if (Array.isArray(parsed)) {
      hits = parsed;
    } else if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).hits)) {
      hits = (parsed as Record<string, unknown>).hits as unknown[];
      wrapper = "hits";
    }

    if (hits) {
      // Truncate long string fields on each hit
      const truncatedHits = hits.map((hit) => {
        if (!hit || typeof hit !== "object") return hit;
        const out: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(hit as Record<string, unknown>)) {
          out[key] = typeof val === "string" ? truncateField(val, fieldCap) : val;
        }
        return out;
      });

      // Build the full stringified result
      const rebuild = (h: unknown[]) =>
        wrapper ? JSON.stringify({ ...(parsed as object), [wrapper]: h }) : JSON.stringify(h);

      let stringified = rebuild(truncatedHits);

      if (stringified.length <= totalBudget) return stringified;

      // Drop trailing hits until under budget
      const originalCount = truncatedHits.length;
      let kept = truncatedHits.slice();
      while (kept.length > 0 && stringified.length > totalBudget) {
        kept = kept.slice(0, -1);
        stringified = rebuild(kept);
      }
      const omittedHits = originalCount - kept.length;
      console.warn(
        `[capMcpResult] Dropped ${omittedHits} of ${originalCount} hits to stay under totalBudget. ` +
          `Payload size before drop: ${new Blob([rebuild(truncatedHits)]).size} bytes.`
      );
      return `${stringified}\n…[omitted ${omittedHits} hits due to size]`;
    }

    // Parsed but not a hit array — fall through to string truncation
    return truncateField(text, totalBudget);
  } catch {
    // JSON.parse failed — treat as plain string
    return truncateField(text, totalBudget);
  }
}
