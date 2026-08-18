/**
 * Reserved-key validation shared by the graph-write propose tools
 * (`src/lib/ai/graphWriteTools.ts`) and the approval handlers
 * (`src/lib/proposals/handleApproval.ts`).
 *
 * The propose-time check keeps the model honest; the approval-time check
 * is the one that actually holds, because the proposal payload reaches
 * `handleApproval` through the client-supplied transcript
 * (`canvasChatMessages` in `/api/ask/quick`) and is therefore forgeable.
 * Both call sites use this module so the two lists can't drift.
 */

/**
 * Reserved / system attribute keys that callers must not set in `node_data`
 * or `edge_data`. Overwriting these would corrupt Jarvis / Neo4j metadata.
 */
export const RESERVED_KEYS = new Set([
  "status",
  "is_deleted",
  "boost",
  "ref_id",
]);

/** `algo_*` covers the graph-algorithm outputs (pagerank, centrality, …). */
export function isReservedKey(key: string): boolean {
  return RESERVED_KEYS.has(key) || key.startsWith("algo_");
}

export function findReservedKeys(data: Record<string, unknown>): string[] {
  return Object.keys(data).filter(isReservedKey);
}

/**
 * Validate every attribute bag carried by a graph-write payload.
 * `entries` is a list of `[label, data]` pairs so the error names the
 * offending field (`edge_data`, `triplets[2].source.node_data`, …).
 *
 * @returns an error string, or `null` when everything is clean.
 */
export function findReservedKeyViolation(
  entries: Array<[string, Record<string, unknown> | undefined]>,
): string | null {
  for (const [label, data] of entries) {
    if (!data || typeof data !== "object") continue;
    const bad = findReservedKeys(data);
    if (bad.length > 0) {
      return `${label} contains reserved key(s): ${bad.join(", ")}.`;
    }
  }
  return null;
}
