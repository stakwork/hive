import { getNodeEdges, listNodesByType, type JarvisGraphEdge, type JarvisGraphNode } from "@/services/swarm/api/nodes";
import { logger } from "@/lib/logger";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import type { SystemMapDomainEdge, SystemMapDomainNode, SystemMapDomainType } from "@/types/system-map";

/** Every node the System Map workflows write carries `namespace: "systemmap"`. */
export const SYSTEM_MAP_NAMESPACE = "systemmap";
export const MAX_DOMAIN_NODES = 5000;
const PAGE_SIZE = 1000;
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
      /** Nodes whose edges were read one by one (the listing came back short for them). */
      edgeReads: number;
    }
  | { ok: false; error: string };

function edgeKey(edge: JarvisGraphEdge): string {
  return `${edge.source}|${edge.edge_type}|${edge.target}`;
}

/** A node's edge count within the namespace (jarvis' `include_edge_counts`), or null when not reported. */
function countedEdges(node: JarvisGraphNode): number | null {
  if (!node.edges || typeof node.edges !== "object") return null;
  return Object.values(node.edges).reduce((sum, n) => sum + (typeof n === "number" ? n : 0), 0);
}

/**
 * One namespace of the workspace graph (`systemmap` unless told otherwise)
 * as a graph, read through boltwall: the nodes and the edges among them
 * from `GET /v2/nodes?namespace=<namespace>&include_edge_counts=true`
 * (paged), keeping only the edges whose both ends are nodes of that read.
 *
 * The listing's edges are capped at 20 neighbours per node and stay within
 * one page, so a node that came back with fewer edges than jarvis counted
 * for it (a hub; a link across pages) — or every node, on a jarvis that
 * reports no edges or counts — has its edges read on their own
 * (`GET /v2/nodes/:ref_id?expand=edges`).
 */
export async function listSystemMapDomainNodes(
  config: JarvisConnectionConfig,
  namespace: string = SYSTEM_MAP_NAMESPACE,
): Promise<ListSystemMapDomainNodesResult> {
  const raw: JarvisGraphNode[] = [];
  const listedEdges = new Map<string, JarvisGraphEdge>();
  let listingHasEdges = true;
  let startingAfter: string | undefined;
  let truncated = true;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listNodesByType(config, "", PAGE_SIZE, {
      startingAfter,
      namespace,
      includeEdgeCounts: true,
    });
    if (!result.ok) {
      return { ok: false, error: result.error || `Failed to read nodes from ${config.jarvisUrl}` };
    }
    raw.push(...result.nodes);
    if (result.edges) for (const e of result.edges) listedEdges.set(edgeKey(e), e);
    else listingHasEdges = false;
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

  // Which nodes the listing came back short for.
  const received = new Map<string, number>();
  for (const e of listedEdges.values()) {
    received.set(e.source, (received.get(e.source) ?? 0) + 1);
    if (e.target !== e.source) received.set(e.target, (received.get(e.target) ?? 0) + 1);
  }
  const counted = new Map(raw.map((n) => [n.ref_id, countedEdges(n)]));
  const short = nodes.filter((node) => {
    const count = counted.get(node.refId);
    return !listingHasEdges || count === null || count === undefined || (received.get(node.refId) ?? 0) < count;
  });

  // Filtering to the map's own types keeps a component's hundreds of
  // CALLS/EXPOSES edges to endpoints from using up the per-node limit.
  const mapTypes = [...new Set(nodes.map((node) => node.type))];
  const edgeReads = await mapWithConcurrency(short, EDGE_CONCURRENCY, (node) =>
    getNodeEdges(config, node.refId, { limit: EDGES_PER_NODE, nodeTypes: mapTypes }),
  );
  const edges = new Map<string, SystemMapDomainEdge>();
  const keep = (edge: JarvisGraphEdge) => {
    if (!byRef.has(edge.source) || !byRef.has(edge.target) || edge.source === edge.target) return;
    const key = edgeKey(edge);
    if (!edges.has(key)) edges.set(key, { source: edge.source, target: edge.target, edgeType: edge.edge_type });
  };
  for (const edge of listedEdges.values()) keep(edge);
  let edgeReadFailures = 0;
  for (const read of edgeReads) {
    if (!read.ok) {
      edgeReadFailures++;
      continue;
    }
    for (const edge of read.edges) keep(edge);
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
    listedEdges: listedEdges.size,
    edgeReads: short.length,
    edgeReadFailures,
  });

  return {
    ok: true,
    types,
    nodes,
    edges: [...edges.values()],
    truncated,
    edgeReadFailures,
    edgeReads: short.length,
  };
}
