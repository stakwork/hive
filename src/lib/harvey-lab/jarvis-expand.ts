/**
 * jarvis-expand.ts
 *
 * Shared depth-1 edge expand helper for Jarvis v2 nodes. Extracted from
 * `legal-benchmark-graph-scores.ts` so both the graph-scores service and the
 * new recursion-summary service share one implementation — no third copy of
 * the fetch shape.
 *
 * Every `ref_id` interpolated into a URL is wrapped in `encodeURIComponent()`
 * so slugs and UUIDs containing special characters never corrupt the path.
 *
 * **Security:** callers must apply `requireAuth` + workspace-gate +
 * `getWorkspaceSwarmAccess` before calling — no authorization happens here.
 */

import type { JarvisConnectionConfig, JarvisNode } from "@/types/jarvis";
import { logger } from "@/lib/logger";

/**
 * Depth-1 edge expand from the Jarvis v2 nodes endpoint.
 *
 * Returns the neighbor nodes (root excluded) or `null` on any failure —
 * failures are per-hop so one dead node doesn't blank the whole request.
 * Never throws.
 */
export async function expandEdges(
  refId: string,
  edgeTypes: string[],
  config: JarvisConnectionConfig,
): Promise<JarvisNode[] | null> {
  const edgeType = encodeURIComponent(`[${edgeTypes.map((t) => `'${t}'`).join(",")}]`);
  const url = `${config.jarvisUrl}/v2/nodes/${encodeURIComponent(refId)}?expand=edges&edge_type=${edgeType}&depth=1`;
  try {
    const res = await fetch(url, { headers: { "x-api-token": config.apiKey } });
    if (!res.ok) {
      logger.warn(
        `[harvey-lab/jarvis-expand] Jarvis expand failed status=${res.status}`,
        "legal",
        { refId, status: res.status },
      );
      return null;
    }
    const data = (await res.json()) as { nodes?: JarvisNode[] };
    return (data?.nodes ?? []).filter((n) => n.ref_id !== refId);
  } catch (err) {
    logger.warn("[harvey-lab/jarvis-expand] Jarvis expand threw", "legal", {
      refId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
