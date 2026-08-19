/**
 * Graph node detail types — the contract of
 * GET /api/workspaces/[slug]/graph/node/[ref_id].
 *
 * Client-safe (no server imports): the Graph Explorer's node panel and the
 * `?ref_id=` deep link both consume this shape. Backed by a single Jarvis
 * `/v2/nodes/{ref_id}?expand=edges` call, so the node and its one-hop
 * neighbors always come from the same snapshot.
 */

/** The queried node itself, with its raw Jarvis properties. */
export interface GraphNodeDetail {
  ref_id: string;
  node_type: string;
  /** Best-effort human label — Jarvis nodes keep it under type-specific keys. */
  name: string;
  properties: Record<string, unknown>;
}

/** One directly-linked node, plus the edge that reaches it. */
export interface GraphNodeNeighbor {
  ref_id: string;
  node_type: string;
  name: string;
  edge_type: string;
  /** `forward` = queried node is the edge source; `reverse` = it's the target. */
  direction: "forward" | "reverse";
  /** Jarvis edge `importance` (0–1), when the edge carries one. */
  importance?: number;
}

export interface GraphNodeDetailResponse {
  node: GraphNodeDetail;
  neighbors: GraphNodeNeighbor[];
}

/** One hit from the Jarvis-backed graph search (`GET /v2/nodes?q=&type=`). */
export interface GraphSearchHit {
  ref_id: string;
  node_type: string;
  name: string;
  /** Truncated description/summary/text, when the node carries one. */
  description: string;
}

export interface GraphSearchResponse {
  results: GraphSearchHit[];
}

/** One selectable node type in the search filter. */
export interface GraphNodeType {
  type: string;
  domain: string | null;
  description: string;
}

export interface GraphNodeTypesResponse {
  node_types: GraphNodeType[];
}
