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
  /**
   * {EDGE_TYPE: count} map of the node's relationships — how connected it is
   * and which edge types can be traversed next. Present only when the call
   * opted in via `includeEdgeCounts`.
   */
  edges?: Record<string, number>;
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
  /**
   * {EDGE_TYPE: count} map of this neighbor's OWN relationships — shows how
   * connected it is and which edge types can be hopped along next. Present
   * only when the call opted in via `includeEdgeCounts`.
   */
  edges?: Record<string, number>;
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

/**
 * Node types that must never surface in graph-walker search or neighbor
 * expansion. These are internal / low-signal types (hint nodes, agent memory,
 * media clips, transcript turns) that pollute results without helping the
 * agent. Excluded server-side by Jarvis (in the Cypher, before LIMIT) via the
 * `exclude_type` / `exclude_node_type` params, so they never consume the result
 * budget. Case-insensitive.
 */
const EXCLUDED_NODE_TYPES = ["Hint", "Memory", "Clip", "Turn"];

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
 * Collapse Jarvis `/connection-counts` rows ([{edge_type, target_type, count}])
 * into a compact `{EDGE_TYPE: totalCount}` map, summing across target types.
 * This mirrors the inline `edges` map returned by kgSearch so both present
 * connectivity the same way.
 */
export function collapseConnectionCounts(
  counts: Array<{ edge_type: string; target_type?: string; count: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of counts ?? []) {
    if (!c?.edge_type) continue;
    out[c.edge_type] = (out[c.edge_type] ?? 0) + Number(c.count ?? 0);
  }
  return out;
}

/**
 * Fetch edge-type connectivity for a node from the dedicated aggregation
 * endpoint (cheap: counts only, no neighbor materialization). Best-effort —
 * returns `{}` on any error, never throws.
 */
async function fetchConnectionCounts(
  jarvisUrl: string,
  swarmApiKey: string,
  refId: string,
): Promise<Record<string, number>> {
  try {
    const url = `${jarvisUrl.replace(/\/$/, "")}/v2/nodes/${encodeURIComponent(refId)}/connection-counts`;
    const res = await kgFetch(url, swarmApiKey);
    if (!res.ok) return {};
    const data = (await res.json()) as {
      counts?: Array<{ edge_type: string; target_type?: string; count: number }>;
    };
    return collapseConnectionCounts(data?.counts ?? []);
  } catch {
    return {};
  }
}

export interface KgGetNodeOpts {
  /**
   * When true, also fetch `/connection-counts` and attach an `edges`
   * ({EDGE_TYPE: count}) map to the returned node. One extra (cheap,
   * aggregation-only) request; failures leave `edges` as `{}`.
   */
  includeEdgeCounts?: boolean;
}

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
  opts?: KgGetNodeOpts,
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
    const node: KgNode = {
      ref_id: raw.ref_id,
      node_type: raw.node_type,
      name: deriveNodeName(raw, properties),
      properties: raw.properties,
    };
    if (opts?.includeEdgeCounts) {
      node.edges = await fetchConnectionCounts(jarvisUrl, swarmApiKey, refId);
    }
    return node;
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
  /**
   * When true, ask Jarvis to attach each neighbor's own {EDGE_TYPE: count}
   * map (`include_edge_counts=true`) so the agent can see where it can hop
   * next without a per-neighbor round trip.
   */
  includeEdgeCounts?: boolean;
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
      // Resolve the node_type filter to the REAL Neo4j label (not the
      // capitalize-normalized schema type) so multi-hump labels like
      // `PullRequest` match. Single-word types are unaffected. See
      // docs/plans/graph-walker-label-canonicalization.md.
      canonicalize: "false",
      // Denylist internal/low-signal neighbor types (Hint/Memory/Clip/Turn).
      // Jarvis drops them in the Cypher before LIMIT so they don't crowd out
      // real neighbors. Python-list-literal format, matching node_type/edge_type.
      exclude_node_type: toPythonListLiteral(EXCLUDED_NODE_TYPES),
    });
    if (opts?.edgeTypes && opts.edgeTypes.length > 0) {
      params.set("edge_type", toPythonListLiteral(opts.edgeTypes));
    }
    if (opts?.nodeTypes && opts.nodeTypes.length > 0) {
      params.set("node_type", toPythonListLiteral(opts.nodeTypes));
    }
    if (opts?.includeEdgeCounts) {
      params.set("include_edge_counts", "true");
    }
    const url = `${jarvisUrl}/v2/nodes/${encodeURIComponent(refId)}?${params.toString()}`;
    const res = await kgFetch(url, swarmApiKey);
    if (!res.ok) return { neighbors: [], reachable: false };

    const data = (await res.json()) as JarvisExpandEdgesResponse;

    // Build a lookup map for node details keyed by ref_id, excluding the queried
    // node itself. Derive a human-readable label here while we still have the
    // node's properties — otherwise the caller only sees a bare ref_id.
    const nodeMap = new Map<
      string,
      { node_type: string; name: string; edges?: Record<string, number> }
    >();
    for (const node of data.nodes ?? []) {
      if (node.ref_id !== refId) {
        nodeMap.set(node.ref_id, {
          node_type: node.node_type,
          name: deriveNodeName(node, (node.properties ?? {}) as Record<string, unknown>),
          ...(opts?.includeEdgeCounts
            ? { edges: (node as { edges?: Record<string, number> }).edges ?? {} }
            : {}),
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
        ...(nodeDetail?.edges !== undefined ? { edges: nodeDetail.edges } : {}),
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
  /** Domain grouping (lowercased), or null when the type has no domain. */
  domain: string | null;
  description: string;
}

export interface KgOntology {
  /** Distinct, non-null, lowercased, sorted domain list. */
  domains: string[];
  node_types: KgSchemaType[];
}

interface JarvisGraphLabelsResponse {
  labels?: Array<{ type?: string; description?: string }>;
}

interface JarvisSchemaResponse {
  schemas?: Array<{
    type?: string;
    domain?: string;
    description?: string;
    is_deleted?: boolean;
  }>;
}

/**
 * Fetch the workspace's KG node-type ontology, merging TWO sources:
 *
 * - `GET /graph/labels` — the REAL Neo4j labels via `db.labels()` (e.g.
 *   `PullRequest`, not the capitalize-normalized `Pullrequest`), including
 *   newly-ingested types that have no schema yet. These are the exact strings
 *   the graph-walker type filters match against. See
 *   docs/plans/graph-walker-label-canonicalization.md.
 * - `GET /v2/schema` — the schema registry, which carries each type's
 *   `domain` grouping and richer descriptions, plus registered types that have
 *   no live nodes yet.
 *
 * The union prefers the real label casing when a type exists in both; domain
 * and description are enriched from the schema (matched case-insensitively).
 * Each source is best-effort: if one fetch fails the other still populates the
 * result. Returns `{ domains: [], node_types: [] }` when both fail.
 * Never throws — matches the behavior of `kgGetNode` / `kgSearch`.
 */
export async function kgGetOntology(
  jarvisUrl: string,
  swarmApiKey: string,
): Promise<KgOntology> {
  const base = jarvisUrl.replace(/\/$/, "");

  const [labels, schemas] = await Promise.all([
    (async () => {
      try {
        const res = await kgFetch(`${base}/graph/labels`, swarmApiKey);
        if (!res.ok) return [];
        const data = (await res.json()) as JarvisGraphLabelsResponse;
        if (!Array.isArray(data?.labels)) return [];
        return data.labels.filter(
          (s): s is { type: string; description?: string } =>
            typeof s?.type === "string" && s.type.length > 0,
        );
      } catch {
        return [];
      }
    })(),
    (async () => {
      try {
        const res = await kgFetch(`${base}/v2/schema`, swarmApiKey);
        if (!res.ok) return [];
        const data = (await res.json()) as JarvisSchemaResponse;
        if (!Array.isArray(data?.schemas)) return [];
        return data.schemas.filter(
          (s): s is { type: string; domain?: string; description?: string } =>
            typeof s?.type === "string" &&
            s.type.length > 0 &&
            s.type !== "*" &&
            !s.is_deleted,
        );
      } catch {
        return [];
      }
    })(),
  ]);

  // lower(type) → schema entry, for case-insensitive enrichment of labels.
  const schemaByLower = new Map<
    string,
    { type: string; domain: string | null; description: string }
  >();
  for (const s of schemas) {
    schemaByLower.set(s.type.toLowerCase(), {
      type: s.type,
      domain: s.domain ? s.domain.toLowerCase() : null,
      description: s.description ?? "",
    });
  }

  const node_types: KgSchemaType[] = [];
  const seenLower = new Set<string>();

  // Real labels first — their casing wins, enriched from the schema.
  for (const l of labels) {
    const lower = l.type.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    const schema = schemaByLower.get(lower);
    node_types.push({
      type: l.type,
      domain: schema?.domain ?? null,
      description: l.description || schema?.description || "",
    });
  }

  // Schema-only types (registered but no live nodes yet).
  for (const s of schemaByLower.values()) {
    const lower = s.type.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    node_types.push({ type: s.type, domain: s.domain, description: s.description });
  }

  const domains = [
    ...new Set(
      node_types.flatMap((nt) => (nt.domain !== null ? [nt.domain] : [])),
    ),
  ].sort();

  return { domains, node_types };
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
// kgGetSubgraph
// ---------------------------------------------------------------------------

import { SUBGRAPH_NODE_TYPES } from "@/lib/harvey-lab/subgraph-node-types";
import { logger } from "@/lib/logger";

export interface KgSubgraphNode {
  ref_id: string;
  node_type: string;
  date_added_to_graph?: string | number;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface KgSubgraphEdge {
  source: string;
  target: string;
  edge_type: string;
  properties?: Record<string, unknown>;
}

export interface KgSubgraph {
  nodes: KgSubgraphNode[];
  edges: KgSubgraphEdge[];
}

export type KgSubgraphResult =
  | { ok: true; subgraph: KgSubgraph }
  | { ok: false; error: string };

/**
 * Hard cap on total nodes + edges returned by kgGetSubgraph.
 * A pathologically large or cyclic trigger/fix history with depth=999 could
 * return an unbounded payload — this prevents an OOM event analogous to the
 * hub-node guard in kgGetNeighbors.
 */
const KG_SUBGRAPH_CAP = 500;

export interface KgGetSubgraphOpts {
  /**
   * Traversal depth. Defaults to 999 (full history). Use a lower value
   * only when you need a bounded hop count.
   */
  depth?: number;
  /**
   * Node types to include. Defaults to SUBGRAPH_NODE_TYPES (the shared
   * EvalTrigger/EvalTriggerOutput/ProposedFix casing-variant list).
   */
  nodeTypes?: string[];
}

/**
 * Fetch a subgraph rooted at `startRefId` from Jarvis's `/graph/subgraph`
 * endpoint (server-side).
 *
 * Uses the same param contract proven by the client-side `fetchSubgraph` in
 * `useEvalRunHistory.ts`:
 *   - `start_node` — the ref_id to root the traversal at
 *   - `node_type`  — JSON-stringified array of node-type strings to include
 *   - `depth`      — traversal depth (999 = full history)
 *   - `include_properties=true` — attach node properties to every result node
 *
 * Do NOT confuse with `kgGetNeighbors` (which uses `expand`/`sort_by`/
 * `canonicalize` — a completely different endpoint contract).
 *
 * Returns a discriminated result so callers can distinguish "fetch failed"
 * (transient error → fail-open) from "no history yet" (empty nodes/edges).
 * Never throws.
 */
export async function kgGetSubgraph(
  jarvisUrl: string,
  swarmApiKey: string,
  startRefId: string,
  opts?: KgGetSubgraphOpts,
): Promise<KgSubgraphResult> {
  try {
    const depth = opts?.depth ?? 999;
    const nodeTypes = opts?.nodeTypes ?? SUBGRAPH_NODE_TYPES;
    const nodeTypeParam = JSON.stringify(nodeTypes);

    const params = new URLSearchParams({
      start_node: startRefId,
      node_type: nodeTypeParam,
      depth: String(depth),
      include_properties: "true",
    });

    const base = jarvisUrl.replace(/\/$/, "");
    const url = `${base}/graph/subgraph?${params.toString()}`;

    const res = await kgFetch(url, swarmApiKey);
    if (!res.ok) {
      return {
        ok: false,
        error: `Jarvis /graph/subgraph returned HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as {
      nodes?: KgSubgraphNode[];
      edges?: KgSubgraphEdge[];
    } | KgSubgraphNode[];

    const raw = Array.isArray(data)
      ? { nodes: data as KgSubgraphNode[], edges: [] }
      : {
          nodes: (data as { nodes?: KgSubgraphNode[] }).nodes ?? [],
          edges: (data as { edges?: KgSubgraphEdge[] }).edges ?? [],
        };

    // ── Size cap: truncate and warn so a pathological history can't OOM ──
    const totalItems = raw.nodes.length + raw.edges.length;
    if (totalItems > KG_SUBGRAPH_CAP) {
      logger.warn(
        "[kg-adapter/kgGetSubgraph] Subgraph exceeds size cap — truncating",
        "legal",
        {
          startRefId,
          nodeCount: raw.nodes.length,
          edgeCount: raw.edges.length,
          cap: KG_SUBGRAPH_CAP,
        },
      );
      // Keep the first KG_SUBGRAPH_CAP/2 nodes and KG_SUBGRAPH_CAP/2 edges
      const nodeSlice = Math.floor(KG_SUBGRAPH_CAP / 2);
      raw.nodes = raw.nodes.slice(0, nodeSlice);
      raw.edges = raw.edges.slice(0, KG_SUBGRAPH_CAP - nodeSlice);
    }

    return { ok: true, subgraph: raw as KgSubgraph };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// kgSearch
// ---------------------------------------------------------------------------

export interface KgSearchOpts {
  type?: string;
  limit?: number;
  /**
   * Semantic search scoped to node INPUT schemas — find nodes by what they
   * take as input (e.g. "a video file url"). Fused with `query` via RRF.
   * Applies to node types with input embeddings (Workflow, Skill).
   */
  inputQ?: string;
  /**
   * Semantic search scoped to node OUTPUT schemas — find nodes by what they
   * produce (e.g. "transcript with word-level timestamps").
   */
  outputQ?: string;
  /** Comma-separated domain filter (e.g. "entity" or "content,entity"). */
  domains?: string;
}

/** A search hit: node summary plus description and connectivity map. */
export interface KgSearchHit extends KgNode {
  description: string;
  /** {EDGE_TYPE: count} map of the node's relationships. */
  edges: Record<string, number>;
}

/**
 * Max length of a search hit's description — long descriptive blobs (content
 * bodies, summaries) must not flood the agent's context in a ranked list.
 */
const DESCRIPTION_MAX = 300;

/** Lowercased set for client-side filtering of internal/low-signal types. */
const EXCLUDED_NODE_TYPES_LOWER = new Set(
  EXCLUDED_NODE_TYPES.map((t) => t.toLowerCase()),
);

/**
 * Hybrid (keyword + semantic) search over Jarvis v2 nodes via the ranked
 * `/v2/nodes` pipeline (the same endpoint the stakgraph mode=graph agent uses).
 * `query`, `inputQ`, and `outputQ` each act as their own retriever, fused into
 * one ranked result set. `include_edge_counts=true` attaches a per-node
 * {EDGE_TYPE: count} map so the agent can gauge connectivity and see which
 * relationship types it can traverse next — without a per-node round trip.
 *
 * The `type` filter is comma-separated; Jarvis resolves it case-insensitively
 * against real Neo4j labels first (so `PullRequest` matches — see
 * docs/plans/graph-walker-label-canonicalization.md). Internal/low-signal
 * types (Hint/Memory/Clip/Turn) are filtered client-side since this endpoint
 * has no node-type denylist param.
 * Returns an array of matching hits, or `[]` on any error.
 */
export async function kgSearch(
  jarvisUrl: string,
  swarmApiKey: string,
  query: string,
  opts?: KgSearchOpts,
): Promise<KgSearchHit[]> {
  if (!query && !opts?.inputQ && !opts?.outputQ) return [];
  try {
    const params = new URLSearchParams({
      limit: String(opts?.limit ?? 20),
      // Attach each hit's {EDGE_TYPE: count} connectivity map inline.
      include_edge_counts: "true",
    });
    if (query) params.set("q", query);
    if (opts?.inputQ) params.set("input_q", opts.inputQ);
    if (opts?.outputQ) params.set("output_q", opts.outputQ);
    if (opts?.type) params.set("type", opts.type);
    if (opts?.domains) params.set("domains", opts.domains);
    const url = `${jarvisUrl.replace(/\/$/, "")}/v2/nodes?${params.toString()}`;
    const res = await kgFetch(url, swarmApiKey);
    if (!res.ok) return [];
    const data = (await res.json()) as JarvisNode[] | { nodes?: JarvisNode[] };
    const nodes = Array.isArray(data) ? data : (data?.nodes ?? []);
    return nodes
      .filter(
        (n) =>
          n.ref_id &&
          !EXCLUDED_NODE_TYPES_LOWER.has((n.node_type ?? "").toLowerCase()),
      )
      .map((n) => {
        const properties = (n.properties ?? {}) as Record<string, unknown>;
        const rawDesc =
          properties.description ?? properties.summary ?? properties.text ?? "";
        const desc = typeof rawDesc === "string" ? rawDesc.trim() : "";
        return {
          ref_id: n.ref_id,
          node_type: n.node_type,
          name: deriveNodeName(n, properties),
          description:
            desc.length > DESCRIPTION_MAX ? desc.slice(0, DESCRIPTION_MAX) : desc,
          edges: (n as { edges?: Record<string, number> }).edges ?? {},
        };
      });
  } catch {
    return [];
  }
}
