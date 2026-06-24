/**
 * kg-adapter — thin HTTP client for Jarvis v2 `/v2/nodes` endpoints.
 *
 * All functions accept a resolved `(jarvisUrl, swarmApiKey)` pair. `jarvisUrl`
 * is the Jarvis knowledge-graph base URL (`:8444`) — NOT the stakgraph base
 * (`:3355`), which does not serve `/v2/nodes`. Auth is via `x-api-token`.
 * All functions catch network / HTTP errors and return null / [] / { neighbors: [], reachable: false }.
 * They never throw.
 */

import type { NeighborResult } from "@/lib/graph-walker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KgNode {
  ref_id: string;
  node_type: string;
  name: string;
  properties?: unknown;
}

interface JarvisEdge {
  source: string;
  target: string;
  edge_type: string;
  properties?: Record<string, unknown>;
}

interface JarvisNode {
  ref_id: string;
  node_type: string;
  name?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

interface JarvisExpandEdgesResponse {
  nodes: JarvisNode[];
  edges: JarvisEdge[];
}

export interface KgNeighborResult extends NeighborResult {
  node_type: string;
  ref_id: string;
}

export interface KgNeighborsResponse {
  neighbors: KgNeighborResult[];
  reachable: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Max neighbors returned in a single hop. Mirrors pgNeighbors' DEFAULT_CAP (50).
 * A hot kg node (e.g. a concept) can connect to hundreds of files/edges; without
 * a cap the tool result floods the agent's context and token budget.
 */
const KG_NEIGHBOR_CAP = 50;

/**
 * Encode an array as a Python list literal string, e.g. `["MODIFIES","CITES"]`.
 * This is the format Jarvis v2 expects for filter params.
 */
function toPythonListLiteral(arr: string[]): string {
  return `[${arr.map((s) => `"${s}"`).join(",")}]`;
}

function authHeaders(swarmApiKey: string): Record<string, string> {
  return { "x-api-token": swarmApiKey };
}

/**
 * Jarvis nodes do not carry a top-level `name` for most node types — the human
 * label lives in `properties` under a type-dependent key. Derive the best
 * available label, falling back to "".
 */
function deriveNodeName(
  node: { name?: unknown },
  properties: Record<string, unknown>,
): string {
  const candidates = [
    node?.name,
    properties.name,
    properties.title,
    properties.entity,
    properties.episode_title,
    properties.show_title,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return "";
}

// ---------------------------------------------------------------------------
// kgGetNode
// ---------------------------------------------------------------------------

/**
 * Fetch a single node by refId.
 * Returns `{ name, node_type, ref_id, properties }` or `null` on any error.
 *
 * The deployed Jarvis wraps the node in `{ nodes, edges, status }` (the queried
 * node is found in `nodes` by ref_id); some builds return the node directly.
 * Both shapes are handled.
 */
export async function kgGetNode(
  jarvisUrl: string,
  swarmApiKey: string,
  refId: string,
): Promise<KgNode | null> {
  try {
    const url = `${jarvisUrl}/v2/nodes/${encodeURIComponent(refId)}`;
    const res = await fetch(url, { headers: authHeaders(swarmApiKey) });
    if (!res.ok) return null;
    const data = (await res.json()) as
      | JarvisNode
      | { nodes?: JarvisNode[] };

    const raw: JarvisNode | undefined =
      data && typeof data === "object" && Array.isArray((data as { nodes?: JarvisNode[] }).nodes)
        ? (data as { nodes: JarvisNode[] }).nodes.find((n) => n.ref_id === refId) ??
          (data as { nodes: JarvisNode[] }).nodes[0]
        : (data as JarvisNode);

    if (!raw || !raw.ref_id) return null;
    const properties = (raw.properties ?? {}) as Record<string, unknown>;
    return {
      ref_id: raw.ref_id,
      node_type: raw.node_type,
      name: deriveNodeName(raw, properties),
      properties: raw.properties,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// kgGetNeighbors
// ---------------------------------------------------------------------------

export interface KgGetNeighborsOpts {
  edgeTypes?: string[];
  nodeTypes?: string[];
}

/**
 * Fetch neighbors of a node via `?expand=edges`.
 *
 * Handles:
 * 1. Bidirectional — direction derived from edge.source vs refId.
 * 2. Source-node dedup — the queried node itself is never in the output.
 * 3. Empty ≠ unreachable — 0 results with a valid response is `{ reachable: true }`.
 * 4. Importance passthrough — `edge.properties.importance` forwarded to neighbor.
 */
export async function kgGetNeighbors(
  jarvisUrl: string,
  swarmApiKey: string,
  refId: string,
  opts?: KgGetNeighborsOpts,
): Promise<KgNeighborsResponse> {
  try {
    const params = new URLSearchParams({ expand: "edges" });
    if (opts?.edgeTypes && opts.edgeTypes.length > 0) {
      params.set("edge_type", toPythonListLiteral(opts.edgeTypes));
    }
    if (opts?.nodeTypes && opts.nodeTypes.length > 0) {
      params.set("node_type", toPythonListLiteral(opts.nodeTypes));
    }
    const url = `${jarvisUrl}/v2/nodes/${encodeURIComponent(refId)}?${params.toString()}`;
    const res = await fetch(url, { headers: authHeaders(swarmApiKey) });
    if (!res.ok) return { neighbors: [], reachable: false };

    const data = (await res.json()) as JarvisExpandEdgesResponse;

    // Build a lookup map for node details keyed by ref_id, excluding the queried node itself.
    const nodeMap = new Map<string, { node_type: string }>();
    for (const node of data.nodes ?? []) {
      if (node.ref_id !== refId) {
        nodeMap.set(node.ref_id, { node_type: node.node_type });
      }
    }

    const neighbors: KgNeighborResult[] = [];
    const seen = new Set<string>();
    for (const edge of data.edges ?? []) {
      const direction: "forward" | "reverse" =
        edge.source === refId ? "forward" : "reverse";
      const neighborRefId = direction === "forward" ? edge.target : edge.source;

      // Skip if the neighbor is the queried node itself (self-loop guard / source dedup)
      if (neighborRefId === refId) continue;

      // Dedup by neighbor — a node can be reached via multiple parallel edges
      // (e.g. several MODIFIES). Keep the first occurrence.
      if (seen.has(neighborRefId)) continue;
      seen.add(neighborRefId);

      const nodeDetail = nodeMap.get(neighborRefId);
      // If the node detail isn't in the nodes array, derive what we can from the edge
      const node_type = nodeDetail?.node_type ?? "unknown";

      const importance = (edge.properties?.importance as number | undefined);

      neighbors.push({
        urn: "", // caller mints the URN using parsed.org / parsed.workspace
        edgeType: edge.edge_type,
        direction,
        node_type,
        ref_id: neighborRefId,
        ...(importance !== undefined ? { importance } : {}),
      });

      // Cap to keep tool output within the agent's context/token budget.
      if (neighbors.length >= KG_NEIGHBOR_CAP) break;
    }

    return { neighbors, reachable: true };
  } catch {
    return { neighbors: [], reachable: false };
  }
}

// ---------------------------------------------------------------------------
// kgSearch
// ---------------------------------------------------------------------------

export interface KgSearchOpts {
  type?: string;
  limit?: number;
}

interface JarvisSearchLiteResponse {
  nodes?: Array<{ node_type: string; ref_id: string; title?: string }>;
}

/**
 * Keyword search over Jarvis v2 nodes via the lightweight `/v2/nodes/search`
 * endpoint, which returns matches-only `{ nodes: [{ node_type, ref_id, title }] }`
 * (no neighbor expansion, no paid properties to strip). The `type` filter is
 * comma-separated; `limit` is capped at 50 server-side.
 * Returns an array of matching node summaries, or `[]` on any error.
 */
export async function kgSearch(
  jarvisUrl: string,
  swarmApiKey: string,
  query: string,
  opts?: KgSearchOpts,
): Promise<KgNode[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      limit: String(opts?.limit ?? 20),
    });
    if (opts?.type) {
      params.set("node_type", opts.type);
    }
    const url = `${jarvisUrl}/v2/nodes/search?${params.toString()}`;
    const res = await fetch(url, { headers: authHeaders(swarmApiKey) });
    if (!res.ok) return [];
    const data = (await res.json()) as JarvisSearchLiteResponse;
    const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
    return nodes
      .filter((n) => n.ref_id)
      .map((n) => ({
        ref_id: n.ref_id,
        node_type: n.node_type,
        name: n.title ?? "",
      }));
  } catch {
    return [];
  }
}
