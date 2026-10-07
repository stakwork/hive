import {
  getNodeEdges,
  listNodesByType,
  type JarvisGraphNode,
} from "@/services/swarm/api/nodes";
import { logger } from "@/lib/logger";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import type {
  SystemMapDomainEdge,
  SystemMapDomainNode,
  SystemMapDomainType,
} from "@/types/system-map";

/** Every node the System Map workflows write carries `namespace: "systemmap"`. */
export const SYSTEM_MAP_NAMESPACE = "systemmap";
/** The CWE check workflow's namespace — a separate namespace in the same graph. */
export const INFOSEC_NAMESPACE = "infosec";
export const MAX_DOMAIN_NODES = 5000;
const PAGE_SIZE = 500;
const MAX_PAGES = MAX_DOMAIN_NODES / PAGE_SIZE;
const EDGE_CONCURRENCY = 8;
const EDGES_PER_NODE = 200;

export function parseDomainNode(node: JarvisGraphNode): SystemMapDomainNode | null {
  if (!node.ref_id) return null;
  const properties = node.properties ?? {};
  const name = typeof properties.name === "string" && properties.name.trim() ? properties.name.trim() : node.ref_id;
  return {
    refId: node.ref_id,
    type: node.node_type || "Unknown",
    name,
    properties,
  };
}

/**
 * jarvis applies `?namespace=` server-side and does not echo the field back
 * in `properties`, so only a node that names a different namespace is dropped
 * (a guard against a jarvis that ignores the filter).
 */
function notInOtherNamespace(node: JarvisGraphNode, namespace: string): boolean {
  const nodeNamespace = node.properties?.namespace ?? (node as { namespace?: unknown }).namespace;
  return nodeNamespace === undefined || nodeNamespace === null || nodeNamespace === namespace;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export type ListSystemMapDomainNodesResult =
  | {
      ok: true;
      types: SystemMapDomainType[];
      nodes: SystemMapDomainNode[];
      edges: SystemMapDomainEdge[];
      truncated: boolean;
      /** Nodes whose edges could not be read; the graph is missing their links. */
      edgeReadFailures: number;
    }
  | { ok: false; error: string };

/**
 * One namespace of the workspace graph (`systemmap` unless told otherwise)
 * as a graph, read through boltwall: the nodes from
 * `GET /v2/nodes?namespace=<namespace>` (paged), then each node's
 * `GET /v2/nodes/:ref_id?expand=edges`, keeping only the edges whose both
 * ends are nodes of that read.
 */
export async function listSystemMapDomainNodes(
  config: JarvisConnectionConfig,
  namespace: string = SYSTEM_MAP_NAMESPACE,
): Promise<ListSystemMapDomainNodesResult> {
  const raw: JarvisGraphNode[] = [];
  let startingAfter: string | undefined;
  let truncated = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listNodesByType(config, "", PAGE_SIZE, { startingAfter, namespace });
    if (!result.ok) {
      return { ok: false, error: result.error || `Failed to read nodes from ${config.jarvisUrl}` };
    }
    raw.push(...result.nodes);
    const lastRefId = result.nodes[result.nodes.length - 1]?.ref_id;
    if (result.nodes.length < PAGE_SIZE || !lastRefId) {
      truncated = false;
      break;
    }
    startingAfter = lastRefId;
  }

  const byRef = new Map<string, SystemMapDomainNode>();
  for (const node of raw.filter((n) => notInOtherNamespace(n, namespace))) {
    const parsed = parseDomainNode(node);
    if (parsed && !byRef.has(parsed.refId)) byRef.set(parsed.refId, parsed);
  }
  const nodes = [...byRef.values()].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  // Filtering to the map's own types keeps a component's hundreds of
  // CALLS/EXPOSES edges to endpoints from using up the per-node limit.
  const mapTypes = [...new Set(nodes.map((node) => node.type))];
  const edgeReads = await mapWithConcurrency(nodes, EDGE_CONCURRENCY, (node) =>
    getNodeEdges(config, node.refId, { limit: EDGES_PER_NODE, nodeTypes: mapTypes }),
  );
  const edges = new Map<string, SystemMapDomainEdge>();
  let edgeReadFailures = 0;
  for (const read of edgeReads) {
    if (!read.ok) {
      edgeReadFailures++;
      continue;
    }
    for (const edge of read.edges) {
      if (!byRef.has(edge.source) || !byRef.has(edge.target) || edge.source === edge.target) continue;
      const key = `${edge.source}|${edge.edge_type}|${edge.target}`;
      if (!edges.has(key)) edges.set(key, { source: edge.source, target: edge.target, edgeType: edge.edge_type });
    }
  }

  const counts = new Map<string, number>();
  for (const node of nodes) counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
  const types: SystemMapDomainType[] = [...counts]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  logger.info("[SystemMap] domain graph", "system-map", {
    jarvisUrl: config.jarvisUrl,
    namespace,
    nodes: nodes.length,
    edges: edges.size,
    edgeReadFailures,
  });

  return { ok: true, types, nodes, edges: [...edges.values()], truncated, edgeReadFailures };
}

