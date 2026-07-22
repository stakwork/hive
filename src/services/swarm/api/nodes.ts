import type {
  JarvisConnectionConfig,
  UpdateNodeRequest,
} from "@/types/jarvis";

interface JarvisApiResponse {
  ok: boolean;
  status: number;
  error?: string;
  body?: unknown;
  // True when the swarm answered 404 — the endpoint doesn't exist on this
  // backend (capability/version mismatch), so callers should skip it rather
  // than retry. Distinct from a transport failure.
  notFound?: boolean;
}

// Cap each request so a single unreachable/hung swarm can't dominate the cron's
// 300 s budget. undici's default *connect* timeout is 10 s and there's no
// request timeout at all, so a swarm that accepts the connection then stalls
// could block far longer — this bounds the whole round-trip. 7 s proved too
// tight for bulk writes: a 100-node Neo4j upsert legitimately takes longer than
// that, so healthy swarms were timing out mid-batch and the mirror cursor could
// never advance. Heavy reads (e.g. the PR backfill) still override via `timeoutMs`.
const REQUEST_TIMEOUT_MS = 30_000;

async function jarvisRequest({
  config,
  endpoint,
  method = "GET",
  data,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: {
  config: JarvisConnectionConfig;
  endpoint: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  data?: unknown;
  timeoutMs?: number;
}): Promise<JarvisApiResponse> {
  const url = `${config.jarvisUrl.replace(/\/$/, "")}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
  try {
    const headers: Record<string, string> = {
      "x-api-token": config.apiKey,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const responseText = await response.text();
      // Include method + URL: a bare status is undebuggable across 17
      // workspaces × N endpoints (a quiet 404 hid a dead swarm for weeks).
      console.error("[Jarvis Nodes] Request failed:", method, url, response.status, responseText);
      return {
        ok: false,
        status: response.status,
        notFound: response.status === 404,
        error: `Request failed with status ${response.status}`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Not all responses have a JSON body
    }

    return {
      ok: true,
      status: response.status,
      body,
    };
  } catch (error) {
    console.error("[Jarvis Nodes] Request error:", method, url, error);
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

export async function addNode(
  config: JarvisConnectionConfig,
  payload: { node_type: string; node_data: Record<string, unknown> },
  opts?: { reprocess?: boolean },
): Promise<{ success: boolean; ref_id?: string; alreadyExists?: boolean; error?: string }> {
  const result = await jarvisRequest({
    config,
    endpoint: "/v2/nodes",
    method: "POST",
    // `reprocess: true` makes Jarvis update an existing node (matched by
    // node_key) in place instead of returning an "already exists" warning.
    data: opts?.reprocess ? { ...payload, reprocess: true } : payload,
  });

  if (!result.ok) {
    return {
      success: false,
      error: result.error || `Failed to create node (status: ${result.status})`,
    };
  }

  const body = result.body as
    | {
        status?: string;
        message?: string;
        data?: { ref_id?: string };
        nodes?: Array<{ ref_id?: string }>;
        status_messages?: string[];
      }
    | undefined;

  // Treat "already exists" warnings as success
  const isAlreadyExists = body?.status_messages?.some((m) =>
    m.toLowerCase().includes("already exists"),
  );

  // Jarvis returns status "Warning" with ref_id in body.data
  // when status_messages is empty and duplicate info is only in body.message
  const isWarningWithRef =
    body?.status?.toLowerCase() === "warning" && !!body?.data?.ref_id;

  const ref_id = body?.data?.ref_id ?? body?.nodes?.[0]?.ref_id;

  if (body?.status === "success") {
    return { success: true, ref_id };
  }

  if (isAlreadyExists || isWarningWithRef) {
    return { success: true, ref_id, alreadyExists: true };
  }

  return {
    success: false,
    error: "Node creation returned unexpected status",
  };
}

/**
 * An edge endpoint can be specified either by its existing `ref_id`, or by
 * `{ node_type, node_data }` — in which case Jarvis resolves (or creates) the
 * node by its schema node_key. The node_key path lets callers wire edges
 * purely from stable identifiers (e.g. a Postgres id) without tracking ref_ids.
 */
export type JarvisEdgeEndpoint =
  | { ref_id: string }
  | { node_type: string; node_data: Record<string, unknown> };

export async function addEdge(
  config: JarvisConnectionConfig,
  payload: {
    edge: { edge_type: string; edge_data?: Record<string, unknown> };
    source: JarvisEdgeEndpoint;
    target: JarvisEdgeEndpoint;
  },
): Promise<{ success: boolean; error?: string }> {
  const result = await jarvisRequest({
    config,
    endpoint: "/node/edge",
    method: "POST",
    data: payload,
  });

  if (!result.ok) {
    return {
      success: false,
      error: result.error || `Failed to create edge (status: ${result.status})`,
    };
  }

  const body = result.body as
    | { status?: string; status_messages?: string[] }
    | undefined;

  const isAlreadyExists = body?.status_messages?.some((m) =>
    m.toLowerCase().includes("already exists"),
  );

  if (body?.status?.toLowerCase() === "success" || isAlreadyExists) {
    return { success: true };
  }

  return { success: false, error: "Edge creation returned unexpected status" };
}

/** Shared fetch+parse logic for both bulk-edge functions. */
async function executeBulkEdgeRequest(
  config: JarvisConnectionConfig,
  edgeList: unknown[],
): Promise<{ success: boolean; errors: string[]; endpointMissing?: boolean }> {
  const result = await jarvisRequest({
    config,
    endpoint: "/v2/edges/bulk",
    method: "POST",
    data: { edge_list: edgeList },
  });

  if (!result.ok) {
    return {
      success: false,
      endpointMissing: result.notFound,
      errors: [result.error || `Failed to create edges (status: ${result.status})`],
    };
  }

  const body = result.body as
    | { status?: string; status_messages?: string[]; edges?: unknown[] }
    | undefined;

  const errors = (body?.status_messages ?? []).filter((m) =>
    m.toLowerCase().startsWith("error"),
  );

  // Silent-no-op detector: jarvis's bulk endpoints report every written OR
  // already-existing edge in `edges`, so a healthy response accounts for the
  // full submission even on idempotent re-runs. A shortfall with no ERROR
  // messages means endpoints silently failed to match (this exact mode — a
  // label-pinned MATCH finding no node — once returned "Success" while
  // writing nothing, and cost weeks). Warn loudly; don't fail the call, since
  // older backends may not return `edges` at all.
  if (errors.length === 0 && Array.isArray(body?.edges) && body!.edges!.length < edgeList.length) {
    console.warn(
      `[Jarvis Nodes] edges/bulk: submitted ${edgeList.length} edges but backend reported ` +
        `${body!.edges!.length} — possible silent no-op (unmatched ref_ids?)`,
    );
  }

  // Success means "no real errors" — NOT status === "success". Jarvis returns
  // status "Warning" whenever status_messages is non-empty, which includes
  // benign notices like duplicate edges being skipped on re-runs
  // (skipped_dup). Treating "Warning" as failure caused the jarvis-mirror
  // cursor (advanced only when nodes AND edges succeed) to freeze for any
  // entity type that writes edges: on the second pass every edge is a dup →
  // "Warning" → edgesOk=false → cursor never advances (tasks/chat stuck while
  // edge-less features advanced fine). Mirror `addNodeBulk`, which already
  // keys success off the error count.
  return {
    success: errors.length === 0,
    errors,
  };
}

export async function addEdgeBulk(
  config: JarvisConnectionConfig,
  edgeList: Array<{
    edge: { edge_type: string; weight?: number; edge_data?: Record<string, unknown> };
    source: JarvisEdgeEndpoint;
    target: JarvisEdgeEndpoint;
  }>,
): Promise<{ success: boolean; errors: string[]; endpointMissing?: boolean }> {
  if (edgeList.length === 0) return { success: true, errors: [] };
  return executeBulkEdgeRequest(config, edgeList);
}

/**
 * Bulk create-or-merge edges where BOTH endpoints are addressed by `ref_id`
 * (Jarvis `/v2/edges/bulk`). Each edge is transformed from flat
 * `source_ref_id`/`target_ref_id` fields into the nested v2 shape
 * `{ source: { ref_id }, target: { ref_id } }`. Idempotent on the backend via
 * the edge_key. Errors are returned, never thrown.
 */
export async function addEdgeByRefBulk(
  config: JarvisConnectionConfig,
  edgeList: Array<{
    edge: { edge_type: string; weight?: number; edge_data?: Record<string, unknown> };
    source_ref_id: string;
    target_ref_id: string;
  }>,
): Promise<{ success: boolean; errors: string[]; endpointMissing?: boolean }> {
  if (edgeList.length === 0) return { success: true, errors: [] };

  // Transform flat ref_id fields into the nested v2 shape.
  const v2EdgeList = edgeList.map(({ edge, source_ref_id, target_ref_id }) => ({
    edge,
    source: { ref_id: source_ref_id },
    target: { ref_id: target_ref_id },
  }));

  return executeBulkEdgeRequest(config, v2EdgeList);
}

/**
 * Bulk create-or-merge nodes in a single request (Jarvis `/node/bulk`).
 * With `reprocess: true`, existing nodes (matched by node_key) are updated in
 * place. Jarvis processes the list sequentially in one Neo4j session, so this
 * collapses many round-trips into one HTTP call. Errors are returned, never
 * thrown. Callers should chunk large lists (see BULK_CHUNK in the mirror cron).
 *
 * NOTE: this must target `/node/bulk`, NOT `/v2/nodes`. The swarm's boltwall
 * gateway reserves `POST /v2/nodes` for its *single-node* handler (`addNodeV2`),
 * which destructures `{ node_type, node_data }` off the body and 400s on an
 * array. `/node/bulk` has no explicit boltwall route, so it falls through the
 * catch-all proxy to jarvis-backend's `create_or_merge_node_bulk` (which reads
 * `node_list`). A prior "v2 migration" pointed this at `/v2/nodes` and silently
 * broke every bulk write with `400 node_type and node_data are required`.
 */
export async function addNodeBulk(
  config: JarvisConnectionConfig,
  nodes: Array<{ node_type: string; node_data: Record<string, unknown> }>,
  opts?: { reprocess?: boolean },
): Promise<{ success: boolean; errors: string[]; endpointMissing?: boolean }> {
  if (nodes.length === 0) return { success: true, errors: [] };

  const nodeList = opts?.reprocess
    ? nodes.map((n) => ({ ...n, reprocess: true }))
    : nodes;

  const result = await jarvisRequest({
    config,
    endpoint: "/node/bulk",
    method: "POST",
    data: { node_list: nodeList },
  });

  if (!result.ok) {
    return {
      success: false,
      endpointMissing: result.notFound,
      errors: [result.error || `Failed to create nodes (status: ${result.status})`],
    };
  }

  const body = result.body as
    | { status?: string; status_messages?: string[] }
    | undefined;

  const errors = (body?.status_messages ?? []).filter((m) =>
    m.toLowerCase().startsWith("error"),
  );

  // Bulk node returns "Warning" when some nodes already existed (without
  // reprocess); treat Success and Warning as non-fatal — only collected
  // "ERROR:" messages indicate real failures.
  return {
    success: errors.length === 0,
    errors,
  };
}

/** A node as returned by the `latest-by-types` read endpoint. */
export interface JarvisGraphNode {
  ref_id: string;
  node_type: string;
  date_added_to_graph?: number;
  properties?: Record<string, unknown>;
}

export interface SearchLatestResult {
  /** False on any transport/HTTP failure — distinct from a successful empty read. */
  ok: boolean;
  nodes: JarvisGraphNode[];
  status?: number;
  /** True when the endpoint 404s (absent on this backend). */
  endpointMissing?: boolean;
  error?: string;
}

/**
 * Read nodes of the given types via `POST /graph/search/latest-by-types`,
 * newest-ingested-first (ordered `date_added_to_graph` DESC). The endpoint has
 * no hard cap — it returns up to the requested per-type limit or the real total,
 * whichever is smaller. `withProperties` is required to read schema properties
 * (e.g. a PullRequest's `number`/`repo`), at the cost of heavier payloads.
 *
 * Never throws. Returns `{ ok }` so callers can distinguish a *failed* read
 * (timeout/404/5xx) from a legitimately *empty* one — the two must not be
 * conflated, or a transient fetch failure looks like "nothing to link." Heavy
 * reads (e.g. the PR backfill) should pass a longer `timeoutMs`.
 */
export async function searchLatestByTypes(
  config: JarvisConnectionConfig,
  nodeTypes: Record<string, number>,
  opts?: { withProperties?: boolean; timeoutMs?: number },
): Promise<SearchLatestResult> {
  const result = await jarvisRequest({
    config,
    endpoint: "/graph/search/latest-by-types",
    method: "POST",
    data: { nodeTypes, include_properties: opts?.withProperties ?? false },
    timeoutMs: opts?.timeoutMs,
  });

  if (!result.ok) {
    return {
      ok: false,
      nodes: [],
      status: result.status,
      endpointMissing: result.notFound,
      error: result.error,
    };
  }

  const body = result.body as { nodes?: JarvisGraphNode[] } | undefined;
  return { ok: true, nodes: Array.isArray(body?.nodes) ? body!.nodes : [], status: result.status };
}

/**
 * Search for nodes by attribute filters via `POST /graph/search/attributes`.
 * Use this for repo-scoped searches — e.g. fetch all File/Function nodes whose
 * `file` property contains a given repo prefix — so only that repo's nodes are
 * returned rather than paging an unscoped "latest N" global result set.
 *
 * `comparator: "contains"` performs a Lucene wildcard match on the attribute's
 * fulltext index. Keep `scopeNodesToRepo` as a post-fetch safety filter since
 * `contains` is not a strict prefix — it can over-match substrings.
 *
 * Returns the same `SearchLatestResult` shape as `searchLatestByTypes` so it
 * is a drop-in replacement at the call site.
 *
 * Never throws. Returns `{ ok: false }` on any transport/HTTP failure.
 */
export async function searchNodesByAttributes(
  config: JarvisConnectionConfig,
  params: {
    nodeTypes: string[];
    filters: Array<{ attribute: string; value: string | boolean; comparator: string }>;
    includeProperties?: boolean;
    limit?: number;
    timeoutMs?: number;
    skipCache?: boolean;
  },
): Promise<SearchLatestResult> {
  const result = await jarvisRequest({
    config,
    endpoint: "/graph/search/attributes",
    method: "POST",
    data: {
      node_type: params.nodeTypes,
      search_filters: params.filters,
      include_properties: params.includeProperties ?? false,
      limit: params.limit ?? 1000,
      skip_cache: params.skipCache ?? false,
    },
    timeoutMs: params.timeoutMs,
  });

  if (!result.ok) {
    return {
      ok: false,
      nodes: [],
      status: result.status,
      endpointMissing: result.notFound,
      error: result.error,
    };
  }

  const body = result.body as { nodes?: JarvisGraphNode[] } | undefined;
  return { ok: true, nodes: Array.isArray(body?.nodes) ? body!.nodes : [], status: result.status };
}

export async function updateNode(
  config: JarvisConnectionConfig,
  request: UpdateNodeRequest,
): Promise<{ success: boolean; error?: string }> {
  if (!request.ref_id) {
    return { success: false, error: "ref_id is required to update a node" };
  }

  const result = await jarvisRequest({
    config,
    endpoint: `/node?ref_id=${encodeURIComponent(request.ref_id)}`,
    method: "PUT",
    data: {
      ref_id: request.ref_id,
      node_type: request.node_type,
      node_data: request.node_data,
    },
  });

  if (!result.ok) {
    return {
      success: false,
      error: result.error || `Failed to update node (status: ${result.status})`,
    };
  }

  return { success: true };
}

export async function deleteNode(
  config: JarvisConnectionConfig,
  refId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${config.jarvisUrl.replace(/\/$/, "")}/v2/nodes/${encodeURIComponent(refId)}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "x-api-token": config.apiKey,
        "X-Is-Admin": "true",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.error("[Jarvis Nodes] deleteNode failed:", response.status, responseText);
      return {
        success: false,
        error: `Request failed with status ${response.status}`,
      };
    }

    const body = await response.json().catch(() => ({})) as { status?: string };
    if (body?.status === "success") {
      return { success: true };
    }

    return { success: true };
  } catch (error) {
    console.error("[Jarvis Nodes] deleteNode error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

export async function patchEdge(
  config: JarvisConnectionConfig,
  edgeRefId: string,
  data: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${config.jarvisUrl.replace(/\/$/, "")}/v2/edges/${encodeURIComponent(edgeRefId)}`;
    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        "x-api-token": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.error("[Jarvis Nodes] patchEdge failed:", response.status, responseText);
      return {
        success: false,
        error: `Request failed with status ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    console.error("[Jarvis Nodes] patchEdge error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

export async function deleteEdge(
  config: JarvisConnectionConfig,
  edgeRefId: string,
): Promise<{ success: boolean; notFound?: boolean; error?: string }> {
  const result = await jarvisRequest({
    config,
    endpoint: `/v2/edges/${encodeURIComponent(edgeRefId)}`,
    method: "DELETE",
  });

  if (!result.ok) {
    return {
      success: false,
      notFound: result.notFound,
      error: result.error || `Request failed with status ${result.status}`,
    };
  }

  return { success: true };
}

// ── Error-impact centrality helpers ──────────────────────────────────────────

export interface CentralityNode {
  ref_id: string;
  node_type: string;
  name: string;
  pagerank?: number;
}

export interface ReferencedCentralityResult {
  ok: boolean;
  nodes: CentralityNode[];
  error?: string;
}

/**
 * Fetch the File/Function nodes referenced by an ErrorIssue KG node and
 * return their centrality properties (pagerank).
 * Uses the existing `/v2/nodes/{refId}?expand=edges` endpoint
 * filtered to REFERENCES edges, which is the same endpoint `kgGetNeighbors`
 * uses — so no new backend surface is required.
 *
 * Never throws — returns `{ ok: false }` on any failure.
 */
export async function getReferencedNodeCentrality(
  config: JarvisConnectionConfig,
  issueRefId: string,
  opts?: { timeoutMs?: number },
): Promise<ReferencedCentralityResult> {
  try {
    const params = new URLSearchParams({
      expand: "edges",
      edge_type: "['REFERENCES']",
      node_type: "['File','Function']",
      canonicalize: "false",
      limit: "100",
    });

    const url = `${config.jarvisUrl.replace(/\/$/, "")}/v2/nodes/${encodeURIComponent(issueRefId)}?${params.toString()}`;

    const signal = AbortSignal.timeout(opts?.timeoutMs ?? REQUEST_TIMEOUT_MS);
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-token": config.apiKey,
        "Content-Type": "application/json",
      },
      signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        nodes: [],
        error: `Jarvis returned ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      nodes?: Array<{
        ref_id: string;
        node_type: string;
        name?: string;
        properties?: Record<string, unknown>;
      }>;
      edges?: Array<{ source: string; target: string; edge_type: string }>;
    };

    // Only keep the neighbor nodes (exclude the queried ErrorIssue node itself)
    const referencedNodes: CentralityNode[] = [];
    const seenRefIds = new Set<string>();

    for (const edge of data.edges ?? []) {
      // REFERENCES edges are outbound from the ErrorIssue — target is the code node
      if (edge.source !== issueRefId || edge.edge_type !== "REFERENCES") continue;
      const neighborRefId = edge.target;
      if (seenRefIds.has(neighborRefId)) continue;
      seenRefIds.add(neighborRefId);

      const node = (data.nodes ?? []).find((n) => n.ref_id === neighborRefId);
      if (!node) continue;

      const p = node.properties ?? {};
      const pagerank = typeof p.pagerank === "number" ? p.pagerank : undefined;
      if (pagerank === undefined) {
        console.debug(
          "[Jarvis Nodes] node has no numeric pagerank — impact score will be 0 for this node",
          { ref_id: node.ref_id, node_type: node.node_type },
        );
      }
      referencedNodes.push({
        ref_id: node.ref_id,
        node_type: node.node_type,
        name: node.name ?? (p.name as string | undefined) ?? (p.file_path as string | undefined) ?? "",
        pagerank,
      });
    }

    return { ok: true, nodes: referencedNodes };
  } catch (error) {
    return {
      ok: false,
      nodes: [],
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}
