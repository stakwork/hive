/**
 * kg-adapter — thin HTTP client for Jarvis v2 `/v2/nodes` endpoints.
 *
 * All functions accept resolved `(swarmUrl, swarmApiKey)` from `resolveKgSeam`.
 * Auth is via `x-api-token` header on every request.
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

interface JarvisExpandEdgesResponse {
  nodes: Array<{ ref_id: string; node_type: string; name?: string; [key: string]: unknown }>;
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
 * Encode an array as a Python list literal string, e.g. `["MODIFIES","CITES"]`.
 * This is the format Jarvis v2 expects for filter params.
 */
function toPythonListLiteral(arr: string[]): string {
  return `[${arr.map((s) => `"${s}"`).join(",")}]`;
}

function authHeaders(swarmApiKey: string): Record<string, string> {
  return { "x-api-token": swarmApiKey };
}

// ---------------------------------------------------------------------------
// kgGetNode
// ---------------------------------------------------------------------------

/**
 * Fetch a single node by refId.
 * Returns `{ name, node_type, ref_id, properties }` or `null` on any error.
 */
export async function kgGetNode(
  swarmUrl: string,
  swarmApiKey: string,
  refId: string,
): Promise<KgNode | null> {
  try {
    const url = `${swarmUrl}/v2/nodes/${encodeURIComponent(refId)}`;
    const res = await fetch(url, { headers: authHeaders(swarmApiKey) });
    if (!res.ok) return null;
    const data = (await res.json()) as KgNode;
    return {
      ref_id: data.ref_id,
      node_type: data.node_type,
      name: data.name,
      properties: data.properties,
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
  swarmUrl: string,
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
    const url = `${swarmUrl}/v2/nodes/${encodeURIComponent(refId)}?${params.toString()}`;
    const res = await fetch(url, { headers: authHeaders(swarmApiKey) });
    if (!res.ok) return { neighbors: [], reachable: false };

    const data = (await res.json()) as JarvisExpandEdgesResponse;

    // Build a lookup map for node details keyed by ref_id, excluding the queried node itself.
    const nodeMap = new Map<string, { node_type: string; name?: string }>();
    for (const node of data.nodes ?? []) {
      if (node.ref_id !== refId) {
        nodeMap.set(node.ref_id, { node_type: node.node_type, name: node.name });
      }
    }

    const neighbors: KgNeighborResult[] = [];
    for (const edge of data.edges ?? []) {
      const direction: "forward" | "reverse" =
        edge.source === refId ? "forward" : "reverse";
      const neighborRefId = direction === "forward" ? edge.target : edge.source;

      // Skip if the neighbor is the queried node itself (self-loop guard / source dedup)
      if (neighborRefId === refId) continue;

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

/**
 * Keyword search over Jarvis v2 nodes.
 * Returns an array of matching node summaries, or `[]` on any error.
 */
export async function kgSearch(
  swarmUrl: string,
  swarmApiKey: string,
  query: string,
  opts?: KgSearchOpts,
): Promise<KgNode[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      limit: String(opts?.limit ?? 20),
      expand: "false",
    });
    if (opts?.type) {
      params.set("node_type", toPythonListLiteral([opts.type]));
    }
    const url = `${swarmUrl}/v2/nodes?${params.toString()}`;
    const res = await fetch(url, { headers: authHeaders(swarmApiKey) });
    if (!res.ok) return [];
    const data = (await res.json()) as KgNode[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
