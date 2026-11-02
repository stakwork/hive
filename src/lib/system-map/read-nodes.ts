/**
 * One workspace's System Map as a graph: Cypher on stakgraph, else jarvis'
 * node listing; under mocks, the mock System Map when the swarm has none of
 * its own. Behind `GET /api/workspaces/:slug/system-map/nodes` and the
 * `focus_canvas` agent tool.
 */

import { mockSystemMapNodes } from "@/app/api/mock/graph/system-map-fixture";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { logger } from "@/lib/logger";
import { listSystemMapDomainNodes, type ListSystemMapDomainNodesResult } from "@/lib/system-map/domain-nodes";
import { listSystemMapDomainNodesCypher } from "@/lib/system-map/domain-nodes-cypher";

export const NOT_CONFIGURED = "Workspace swarm is not configured";

export async function readSystemMapNodes(args: {
  slug: string;
  userId: string;
  workspaceId: string;
  namespace: string;
  types?: string[];
}): Promise<ListSystemMapDomainNodesResult> {
  const mocks = process.env.USE_MOCKS === "true";
  const { slug, userId, workspaceId, namespace, types } = args;
  let listed: ListSystemMapDomainNodesResult | null = mocks
    ? null
    : await listSystemMapDomainNodesCypher({ slug, userId, namespace, types });
  if (listed && !listed.ok) {
    logger.warn("[SystemMap] cypher read failed, falling back to jarvis", "system-map", { slug, error: listed.error });
  }
  if (!listed?.ok) {
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (jarvisConfig) listed = await listSystemMapDomainNodes(jarvisConfig, namespace, { types });
    else if (!mocks) return { ok: false, error: NOT_CONFIGURED };
  }
  // Under mocks, a swarm with no System Map of its own gets the mock one.
  if (mocks && (!listed?.ok || listed.nodes.length === 0)) return mockSystemMapNodes(types);
  return listed ?? { ok: false, error: NOT_CONFIGURED };
}
