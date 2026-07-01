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
  /** Best-effort human-readable label for the neighbor (see deriveNodeName). */
  name: string;
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
 * Hard limit sent to Jarvis on every node/neighbor query. This is NOT just a
 * result cap — Jarvis applies it inside the Cypher, which is what stops a hub
 * node (a concept touching hundreds of files) from collecting its entire
 * neighborhood into one row and blowing past Neo4j's per-transaction memory
 * limit (a MemoryPoolOutOfMemoryError → 500 after ~50s). Always send it.
 */
const KG_QUERY_LIMIT = KG_NEIGHBOR_CAP;

/**
 * Fail fast instead of hanging the agent's tool call on a pathological node.
 * Kept tight on purpose: with `limit` bounding the Cypher, healthy queries
 * return in ~1s, so anything past a few seconds means the graph is overloaded
 * (or massive) and we'd rather surface that quickly than block the agent.
 */
const KG_FETCH_TIMEOUT_MS = 25_000;

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

/** fetch with an abort timeout so a slow/overloaded swarm fails fast. */
async function kgFetch(url: string, swarmApiKey: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KG_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: authHeaders(swarmApiKey),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Max length of a derived label. Long text blobs (summary/description/content)
 * are valid last-resort identifiers but must be truncated so a single neighbor
 * row doesn't flood the agent's context.
 */
const LABEL_MAX = 160;

/**
 * Jarvis nodes do not carry a top-level `name` for most node types — and
 * different node types (File, Function, Concept, Endpoint, Datamodel, Page,
 * Person, Episode, …) keep their human label under wildly different keys.
 *
 * Rather than enumerate every type, try a generous ordered list of candidate
 * keys: short, identifier-like fields first (name/title/file/path/symbol), then
 * progressively longer descriptive fields as a last resort. The goal is to give
 * the agent *some* semantic identifier alongside the URN/ref_id (not in place of
 * it) so it can tell neighbors apart. Returns "" only when nothing usable exists.
 */
function deriveNodeName(
  node: { name?: unknown },
  properties: Record<string, unknown>,
): string {
  const candidates = [
    // Top-level name (rare but authoritative)
    node?.name,
    properties.name,
    // Generic human labels
    properties.title,
    properties.label,
    properties.display_name,
    properties.displayName,
    properties.identifier,
    // Code-graph identifiers (File / Function / Class / Endpoint / Datamodel)
    properties.file_name,
    properties.fileName,
    properties.file,
    properties.path,
    properties.symbol,
    properties.function_name,
    properties.class_name,
    properties.method_name,
    properties.operation_id,
    properties.endpoint,
    properties.route,
    properties.url,
    // Misc keys
    properties.entity,
    properties.key,
    properties.slug,
    properties.episode_title,
    properties.show_title,
    properties.username,
    properties.email,
    // Long descriptive fields — valid but truncated last-resort labels
    properties.summary,
    properties.description,
    properties.text,
    properties.content,
    properties.body,
    properties.docs,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) {
      const trimmed = c.trim();
      return trimmed.length > LABEL_MAX ? trimmed.slice(0, LABEL_MAX) : trimmed;
    }
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
    // limit=1 keeps Jarvis from materializing the node's whole neighborhood
    // (which OOMs Neo4j for hub nodes). We only read the node itself here.
    const url = `${jarvisUrl}/v2/nodes/${encodeURIComponent(refId)}?limit=1`;
    const res = await kgFetch(url, swarmApiKey);
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
// kgGetNodesByRefs
// ---------------------------------------------------------------------------

/**
 * Max ref_ids to send in a single by-refs batch. Mirrors KG_NEIGHBOR_CAP — a
 * traversal never surfaces more kg neighbors than that, so one POST covers a
 * whole hop's worth of cross-realm labels.
 */
const KG_BY_REFS_CAP = KG_NEIGHBOR_CAP;

/**
 * Bulk-resolve human-readable labels for a list of kg ref_ids in ONE request,
 * via `POST /v2/nodes/by-refs` (the internal boltwall bulk-fetch — gated by the
 * swarm `x-api-token`, which we already hold). Used to label cross-realm kg
 * neighbors that arrive through a Postgres `UrnEdge` bridge (e.g. a feature's
 * `implemented-by` concepts), where the bare edge carries no node properties.
 *
 * Returns a `Map<ref_id, name>` containing only entries with a non-empty derived
 * name. Soft-deleted / muted nodes are excluded server-side. Returns an empty
 * map on any error — labeling is best-effort and must never fail a traversal.
 */
export async function kgGetNodesByRefs(
  jarvisUrl: string,
  swarmApiKey: string,
  refIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(refIds.filter((r) => r))].slice(0, KG_BY_REFS_CAP);
  if (unique.length === 0) return out;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), KG_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${jarvisUrl.replace(/\/$/, "")}/v2/nodes/by-refs`, {
      method: "POST",
      headers: { ...authHeaders(swarmApiKey), "Content-Type": "application/json" },
      body: JSON.stringify({ ref_ids: unique }),
      signal: controller.signal,
    });
    if (!res.ok) return out;
    const data = (await res.json()) as { nodes?: JarvisNode[] };
    for (const node of data.nodes ?? []) {
      if (!node?.ref_id) continue;
      const name = deriveNodeName(node, (node.properties ?? {}) as Record<string, unknown>);
      if (name) out.set(node.ref_id, name);
    }
    return out;
  } catch {
    return out;
  } finally {
    clearTimeout(timer);
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
    // `limit` is mandatory — it bounds the Cypher traversal so a hub node
    // doesn't OOM Neo4j. We cap the output client-side at KG_NEIGHBOR_CAP too.
    //
    // `sort_by=importance` makes Jarvis order edges by their `importance`
    // property BEFORE applying `limit` (depth=1 only), so the cap keeps the most
    // important neighbors (e.g. a Concept's documentation files, scored 0.5–1.0)
    // instead of an arbitrary slice. Harmless for edges without importance —
    // Jarvis coalesces a missing value to 0.
    const params = new URLSearchParams({
      expand: "edges",
      limit: String(KG_QUERY_LIMIT),
      sort_by: "importance",
    });
    if (opts?.edgeTypes && opts.edgeTypes.length > 0) {
      params.set("edge_type", toPythonListLiteral(opts.edgeTypes));
    }
    if (opts?.nodeTypes && opts.nodeTypes.length > 0) {
      params.set("node_type", toPythonListLiteral(opts.nodeTypes));
    }
    const url = `${jarvisUrl}/v2/nodes/${encodeURIComponent(refId)}?${params.toString()}`;
    const res = await kgFetch(url, swarmApiKey);
    if (!res.ok) return { neighbors: [], reachable: false };

    const data = (await res.json()) as JarvisExpandEdgesResponse;

    // Build a lookup map for node details keyed by ref_id, excluding the queried
    // node itself. Derive a human-readable label here while we still have the
    // node's properties — otherwise the caller only sees a bare ref_id.
    const nodeMap = new Map<string, { node_type: string; name: string }>();
    for (const node of data.nodes ?? []) {
      if (node.ref_id !== refId) {
        nodeMap.set(node.ref_id, {
          node_type: node.node_type,
          name: deriveNodeName(node, (node.properties ?? {}) as Record<string, unknown>),
        });
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
        name: nodeDetail?.name ?? "",
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
// kgGetOntology
// ---------------------------------------------------------------------------

export interface KgSchemaType {
  type: string;
  description: string;
}

interface JarvisSchemaAllResponse {
  schemas?: Array<{ type?: string; description?: string }>;
  edges?: unknown[];
}

/**
 * Fetch the workspace's KG node-type ontology from `GET /schema/all?concise=true`.
 *
 * Returns a `{ type, description }[]` list parsed from `data.schemas` (edges ignored).
 * Returns `[]` on non-ok response, thrown fetch, or malformed/missing schemas.
 * Never throws — matches the behavior of `kgGetNode` / `kgSearch`.
 */
export async function kgGetOntology(
  jarvisUrl: string,
  swarmApiKey: string,
): Promise<KgSchemaType[]> {
  try {
    const url = `${jarvisUrl}/schema/all?concise=true`;
    const res = await kgFetch(url, swarmApiKey);
    if (!res.ok) return [];
    const data = (await res.json()) as JarvisSchemaAllResponse;
    if (!Array.isArray(data?.schemas)) return [];
    return data.schemas
      .filter((s) => typeof s?.type === "string" && s.type.length > 0)
      .map((s) => ({ type: s.type as string, description: s.description ?? "" }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// kgGetNodesByType
// ---------------------------------------------------------------------------

/**
 * Fetch nodes of a given type via `GET /v2/nodes?type=X&limit=N`.
 *
 * Handles both response shapes Jarvis may emit:
 * - Raw array: `[{ ref_id, node_type, properties, ... }]`
 * - Wrapped object: `{ nodes: [...] }`
 *
 * Returns `[]` on non-ok response, thrown fetch, or missing/empty results.
 * Never throws.
 */
export async function kgGetNodesByType(
  jarvisUrl: string,
  swarmApiKey: string,
  nodeType: string,
  limit: number,
): Promise<KgNode[]> {
  try {
    const params = new URLSearchParams({ type: nodeType, limit: String(limit) });
    const url = `${jarvisUrl.replace(/\/$/, "")}/v2/nodes?${params.toString()}`;
    const res = await kgFetch(url, swarmApiKey);
    if (!res.ok) return [];
    const data = (await res.json()) as JarvisNode[] | { nodes?: JarvisNode[] };
    const raw = Array.isArray(data) ? data : (data?.nodes ?? []);
    return raw
      .filter((n) => n.ref_id)
      .map((n) => ({
        ref_id: n.ref_id,
        node_type: n.node_type,
        name: deriveNodeName(n, (n.properties ?? {}) as Record<string, unknown>),
        properties: n.properties,
      }));
  } catch {
    return [];
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
    const res = await kgFetch(url, swarmApiKey);
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
