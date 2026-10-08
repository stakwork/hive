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
  extraHeaders,
}: {
  config: JarvisConnectionConfig;
  endpoint: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  data?: unknown;
  timeoutMs?: number;
  extraHeaders?: Record<string, string>;
}): Promise<JarvisApiResponse> {
  const url = `${config.jarvisUrl.replace(/\/$/, "")}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
  try {
    const headers: Record<string, string> = {
      "x-api-token": config.apiKey,
      "Content-Type": "application/json",
      ...extraHeaders,
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

/**
 * Jarvis error bodies (node_service.py) carry the actual failure detail in
 * `status_messages: string[]`, not `message` — e.g. create_or_merge_edge
 * returns `{ status: "Error", status_messages: [...] }`. Fold both into the
 * failure string so callers' warnings are self-diagnosing, capped so a
 * pathological body can't flood logs.
 */
const MAX_FAILURE_DETAIL_LEN = 500;

function describeJarvisFailure(
  fallback: string,
  body?: { message?: string; status_messages?: string[] },
): string {
  const detail = [body?.message, ...(body?.status_messages ?? [])]
    .filter((m): m is string => typeof m === "string" && m.length > 0)
    .join("; ");
  if (!detail) return fallback;
  const truncated =
    detail.length > MAX_FAILURE_DETAIL_LEN
      ? `${detail.slice(0, MAX_FAILURE_DETAIL_LEN)}…`
      : detail;
  return `${fallback}: ${truncated}`;
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
    error: describeJarvisFailure("Node creation returned unexpected status", body),
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

  return {
    success: false,
    error: describeJarvisFailure("Edge creation returned unexpected status", body),
  };
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

  // Jarvis error bodies set status "Error" but the detail in status_messages
  // need not start with "error" — without this guard such a response falls
  // through the filter above and reads as success.
  if (errors.length === 0 && (body?.status ?? "").toLowerCase() === "error") {
    return {
      success: false,
      errors: [describeJarvisFailure("Bulk edge creation returned status Error", body)],
    };
  }

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

  // Same "Error"-status gap as executeBulkEdgeRequest: surface the body's
  // detail instead of silently succeeding.
  if (errors.length === 0 && (body?.status ?? "").toLowerCase() === "error") {
    return {
      success: false,
      errors: [describeJarvisFailure("Bulk node creation returned status Error", body)],
    };
  }

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
    // `null` is allowed so callers can pass `{ comparator: "!=", value: null }` to Jarvis
    // `/graph/search/attributes`. Jarvis passes `comparator` verbatim, so `"!=" + null` is a
    // best-effort attempt — if Jarvis rejects it, fall back to `comparator: "exists"` with
    // `value: ""` and log a warning, or use a post-fetch JS filter on the returned nodes.
    filters: Array<{ attribute: string; value: string | boolean | null; comparator: string }>;
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

/**
 * List nodes of a given type via `GET /v2/nodes?type=X&limit=N`.
 *
 * `startingAfter` is jarvis' cursor (the last `ref_id` of the previous page);
 * `fields` restricts `properties` to the named keys so large bodies stay
 * server-side. An empty `nodeType` omits the type filter; `namespace` adds
 * jarvis' `n.namespace = $namespace` partition filter.
 *
 * Never throws. Returns `{ ok }` so callers can distinguish a failed Jarvis
 * read from a legitimately empty result — `kgGetNodesByType` cannot.
 */
export async function listNodesByType(
  config: JarvisConnectionConfig,
  nodeType: string,
  limit = 500,
  options: { startingAfter?: string; fields?: string[]; namespace?: string } = {},
): Promise<SearchLatestResult> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (nodeType) params.set("type", nodeType);
  if (options.namespace) params.set("namespace", options.namespace);
  if (options.startingAfter) params.set("starting_after", options.startingAfter);
  if (options.fields?.length) params.set("fields", options.fields.join(","));

  const result = await jarvisRequest({
    config,
    endpoint: `/v2/nodes?${params.toString()}`,
    method: "GET",
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

  const body = result.body as
    | JarvisGraphNode[]
    | { nodes?: JarvisGraphNode[]; status?: string }
    | undefined;

  const raw = Array.isArray(body) ? body : Array.isArray(body?.nodes) ? body.nodes : [];
  return { ok: true, nodes: raw, status: result.status };
}

export interface JarvisCallerSystem {
  system: string;
  call_sites: number;
}

export interface JarvisCallersTarget {
  ref_id: string;
  name: string | null;
  verb: string | null;
  file: string | null;
  system: string;
  callers: JarvisCallerSystem[];
}

export interface JarvisCallersResult {
  ok: boolean;
  targets: JarvisCallersTarget[];
  /** caller -> callee system matrix summed over all targets. */
  systems: Array<{ caller: string; callee: string; call_sites: number }>;
  status?: number;
  endpointMissing?: boolean;
  error?: string;
}

/**
 * Every `targetType` node with its callers grouped by system via
 * `GET /v2/graph/callers`. A system is the leading segments of a node's
 * `file` (`stakwork/hive`). Never throws.
 */
export async function getGraphCallers(
  config: JarvisConnectionConfig,
  params: { edgeType?: string; sourceType?: string; targetType?: string; systemDepth?: number } = {},
): Promise<JarvisCallersResult> {
  const query = new URLSearchParams({
    edge_type: params.edgeType ?? "CALLS",
    source_type: params.sourceType ?? "Request",
    target_type: params.targetType ?? "Endpoint",
  });
  if (params.systemDepth) query.set("system_depth", String(params.systemDepth));

  const result = await jarvisRequest({
    config,
    endpoint: `/v2/graph/callers?${query.toString()}`,
    method: "GET",
  });

  if (!result.ok) {
    return {
      ok: false,
      targets: [],
      systems: [],
      status: result.status,
      endpointMissing: result.notFound,
      error: result.error,
    };
  }

  const body = result.body as Partial<Pick<JarvisCallersResult, "targets" | "systems">> | undefined;
  return {
    ok: true,
    targets: Array.isArray(body?.targets) ? body.targets : [],
    systems: Array.isArray(body?.systems) ? body.systems : [],
    status: result.status,
  };
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

/**
 * Remove an edge via `DELETE /v2/edges/{ref_id}`.
 *
 * Jarvis does not delete the relationship: it sets `is_muted = true` on it
 * and leaves it in Neo4j, so every read that lists edges must skip muted
 * ones (see `isMutedEdge`). A ref_id that matches nothing comes back as
 * 200 + `{ status: "Warning", status_messages: ["Warning: No edge found…"] }`,
 * surfaced here as `notFound`. Never throws.
 */
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

  const body = result.body as
    | { status?: string; status_messages?: string[] }
    | undefined;
  const status = (body?.status ?? "").toLowerCase();
  if (
    status === "warning" &&
    (body?.status_messages ?? []).some((m) => /no edge found/i.test(m))
  ) {
    return {
      success: false,
      notFound: true,
      error: describeJarvisFailure("Edge not found", body),
    };
  }
  if (status === "error") {
    return {
      success: false,
      error: describeJarvisFailure("Edge delete returned status Error", body),
    };
  }

  return { success: true };
}

/**
 * Soft-delete exactly one node via `DELETE /v2/nodes/{ref_id}/single`.
 *
 * Jarvis marks the node `is_deleted` and mutes its edges in one write, and
 * returns the node's `is_deleted` from that write. Success here means that
 * value came back true for this ref_id — never just a 200. A node that is
 * missing (404) or already deleted (409) is surfaced as `notFound`. Jarvis
 * looks the node up by namespace (default "default" when the query param is
 * absent), so a node in another namespace needs `namespace`. Unlike
 * `deleteNode`, nothing else from the node's ingestion run is touched.
 * Never throws.
 */
export async function deleteSingleNode(
  config: JarvisConnectionConfig,
  refId: string,
  namespace?: string,
): Promise<{ success: boolean; notFound?: boolean; mutedEdgeCount?: number; error?: string }> {
  if (!isSafeRefId(refId)) {
    return { success: false, error: `Invalid ref_id: ${JSON.stringify(refId)}` };
  }
  const result = await jarvisRequest({
    config,
    endpoint: `/v2/nodes/${encodeURIComponent(refId)}/single${
      namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""
    }`,
    method: "DELETE",
    extraHeaders: { "X-Is-Admin": "true" },
  });

  if (!result.ok) {
    if (result.status === 404) {
      return {
        success: false,
        notFound: true,
        error: `Node not found in namespace "${namespace || "default"}" — it may live in a different namespace or not exist.`,
      };
    }
    if (result.status === 409) {
      return { success: false, notFound: true, error: "Node was already deleted." };
    }
    return {
      success: false,
      notFound: false,
      error: result.error || `Request failed with status ${result.status}`,
    };
  }

  const body = result.body as
    | { ref_id?: string; is_deleted?: boolean; muted_edge_count?: number }
    | undefined;
  if (body?.ref_id !== refId || body?.is_deleted !== true) {
    return {
      success: false,
      error: "Jarvis did not confirm the node was deleted.",
    };
  }

  return { success: true, mutedEdgeCount: body.muted_edge_count ?? 0 };
}

/**
 * True for an edge Jarvis has muted (`DELETE /v2/edges/{ref_id}`) or marked
 * deleted: it is still stored, but no read should show it.
 */
export function isMutedEdge(properties: Record<string, unknown> | undefined): boolean {
  return properties?.is_muted === true || properties?.is_deleted === true;
}

// ── Jarvis v2 write helpers (user-approved graph writes) ─────────────────────

/**
 * Normalised result returned by every v2 write/read helper.
 * Raw Jarvis response bodies are never forwarded to callers.
 */
export interface JarvisV2Result {
  success: boolean;
  ref_id?: string;
  status?: string;
  message?: string;
  alreadyExists?: boolean;
}

/**
 * Allowed charset for opaque Jarvis ref_ids.
 * Rejects path-traversal-shaped values (containing `/`, `..`, `\0`, etc.)
 * before the value is interpolated into a URL segment.
 */
const REF_ID_SAFE_RE = /^[A-Za-z0-9_\-.:@]+$/;

function isSafeRefId(ref_id: string): boolean {
  return typeof ref_id === "string" && ref_id.length > 0 && REF_ID_SAFE_RE.test(ref_id);
}

/**
 * Update an existing node via `POST /v2/nodes/{ref_id}`.
 * Body is `{ node_data }` only — never `node_type`, `type_to_be_deleted`, or
 * `properties_to_be_deleted` (merge-only; property deletion is out of scope).
 *
 * Success requires BOTH `res.ok` AND `body.status === "success"` because
 * Jarvis can return HTTP 200 with `{ status: "fail", message }` on a
 * node_key collision.
 *
 * Does NOT send `X-Is-Admin` — user-approved writes must not execute with
 * admin authority on Jarvis.
 *
 * Jarvis looks the node up by namespace (default "default" when the query
 * param is absent), so a node in another namespace needs `namespace`.
 *
 * Never throws.
 */
export async function updateNodeV2(
  config: JarvisConnectionConfig,
  ref_id: string,
  node_data: Record<string, unknown>,
  namespace?: string,
): Promise<JarvisV2Result> {
  if (!isSafeRefId(ref_id)) {
    return {
      success: false,
      message: `Invalid ref_id: must match [A-Za-z0-9_\\-.:@]+ (got ${JSON.stringify(ref_id)})`,
    };
  }

  const result = await jarvisRequest({
    config,
    endpoint: `/v2/nodes/${encodeURIComponent(ref_id)}${
      namespace?.trim() ? `?namespace=${encodeURIComponent(namespace)}` : ""
    }`,
    method: "POST",
    data: { node_data },
  });

  if (!result.ok) {
    return {
      success: false,
      status: String(result.status),
      message: result.error ?? `Request failed with status ${result.status}`,
    };
  }

  const body = result.body as
    | { status?: string; message?: string; status_messages?: string[] }
    | undefined;

  // Jarvis `update_node` returns 200 + { status: "fail", message } on failure
  if (body?.status === "success") {
    return { success: true, ref_id, status: "success" };
  }

  return {
    success: false,
    status: body?.status,
    message: describeJarvisFailure("Node update returned unexpected status", body),
  };
}

/**
 * Create an edge via `POST /v2/edges`.
 *
 * `create_schema_if_missing` is hardcoded `false` and never accepted from
 * callers — an approved chat click must not permanently extend a workspace's
 * ontology.
 *
 * Treats `status ∈ { "success", "Warning" }` as success (matching the
 * existing `executeBulkEdgeRequest` comment: Jarvis returns "Warning" on
 * duplicate edges which is benign).
 *
 * Does NOT send `X-Is-Admin`.  Never throws.
 */
export async function addEdgeV2(
  config: JarvisConnectionConfig,
  payload: {
    edge: { edge_type: string; weight?: number; edge_data?: Record<string, unknown> };
    source: JarvisEdgeEndpoint;
    target: JarvisEdgeEndpoint;
  },
): Promise<JarvisV2Result> {
  const result = await jarvisRequest({
    config,
    endpoint: "/v2/edges",
    method: "POST",
    data: {
      edge: payload.edge,
      source: payload.source,
      target: payload.target,
      create_schema_if_missing: false,
    },
  });

  if (!result.ok) {
    return {
      success: false,
      status: String(result.status),
      message: result.error ?? `Request failed with status ${result.status}`,
    };
  }

  const body = result.body as
    | {
        status?: string;
        message?: string;
        status_messages?: string[];
        data?: { ref_id?: string };
        edges?: Array<{ ref_id?: string }>;
      }
    | undefined;

  // "Warning" on duplicate edge is treated as success (same as executeBulkEdgeRequest).
  const statusLower = (body?.status ?? "").toLowerCase();
  if (statusLower === "success" || statusLower === "warning") {
    const ref_id = body?.edges?.[0]?.ref_id ?? body?.data?.ref_id;
    const alreadyExists = statusLower === "warning";
    return { success: true, ref_id, status: body?.status, alreadyExists };
  }

  return {
    success: false,
    status: body?.status,
    message: describeJarvisFailure("Edge creation returned unexpected status", body),
  };
}

/**
 * Read a single node by `ref_id` via `GET /v2/nodes/{ref_id}`.
 * Used by the `propose_node_edit` tool at propose time to:
 *  - confirm the node exists in the workspace's graph
 *  - supply the current properties for the diff view (`meta.oldStr`)
 *
 * `namespace` is optional and usually unnecessary (callers typically discover
 * the node's namespace FROM this read, for a subsequent `updateNodeV2` /
 * `deleteSingleNode` call). Pass it when the caller already knows it (e.g. the
 * client read the node through a namespace-agnostic path, like a raw Cypher
 * match on `ref_id`) — some Jarvis deployments scope even the plain
 * single-node GET to one namespace (default "default" when absent), so a
 * node living in another namespace can otherwise 404 here before its
 * namespace is ever learned.
 *
 * Returns `{ success: false }` for any failure (not found, transport error, etc.).
 * Never throws.
 */
export async function readNodeByRef(
  config: JarvisConnectionConfig,
  ref_id: string,
  namespace?: string,
): Promise<
  JarvisV2Result & { properties?: Record<string, unknown>; node_type?: string; namespace?: string }
> {
  if (!isSafeRefId(ref_id)) {
    return {
      success: false,
      message: `Invalid ref_id: must match [A-Za-z0-9_\\-.:@]+ (got ${JSON.stringify(ref_id)})`,
    };
  }

  // limit=1 keeps Jarvis from materializing the node's whole neighborhood,
  // which can OOM Neo4j on hub nodes — we only need the node itself here.
  const result = await jarvisRequest({
    config,
    endpoint: `/v2/nodes/${encodeURIComponent(ref_id)}?limit=1${
      namespace?.trim() ? `&namespace=${encodeURIComponent(namespace)}` : ""
    }`,
    method: "GET",
  });

  if (!result.ok) {
    return {
      success: false,
      status: String(result.status),
      message: result.error ?? `Request failed with status ${result.status}`,
    };
  }

  const body = result.body as
    | {
        nodes?: Array<{
          ref_id?: string;
          node_type?: string;
          namespace?: string;
          properties?: Record<string, unknown>;
        }>;
        ref_id?: string;
        node_type?: string;
        namespace?: string;
        properties?: Record<string, unknown>;
      }
    | undefined;

  // Deployed Jarvis wraps the node in `{ nodes, edges, status }`; some builds
  // return the node directly. Handle both shapes (mirrors stakgraph's graph_get).
  const node = Array.isArray(body?.nodes)
    ? body!.nodes!.find((n) => n?.ref_id === ref_id) ?? body!.nodes![0]
    : body;
  const resolvedRefId = node?.ref_id ?? ref_id;
  // Jarvis removes `namespace` from `properties` through GENERIC_NODE_PROPERTIES
  // and returns it as a top-level field; fall back to `properties` for older shapes.
  const resolvedNamespace = node?.namespace ?? node?.properties?.namespace;

  return {
    success: true,
    ref_id: resolvedRefId,
    node_type: node?.node_type,
    properties: node?.properties,
    ...(typeof resolvedNamespace === "string" && resolvedNamespace ? { namespace: resolvedNamespace } : {}),
    status: "success",
  };
}

/** A Neo4j relationship type as Jarvis's `edge_type` filter accepts it. */
const EDGE_TYPE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * Edges of one type read from a node when an edge is looked up by its ends.
 * Higher than the walker's neighbor cap: one type is bounded, and a parent
 * with a few hundred children must still find the one child asked about.
 */
const EDGE_LOOKUP_LIMIT = 500;

interface ExpandedEdge {
  ref_id: string;
  source: string;
  target: string;
  edge_type: string;
  properties: Record<string, unknown>;
}

/** A node's edges of one type, both directions, with a name for every node in the answer. */
async function readEdgesOfType(
  config: JarvisConnectionConfig,
  ref_id: string,
  edge_type: string,
): Promise<{ ok: true; edges: ExpandedEdge[]; names: Map<string, string> } | { ok: false; status?: string; message: string }> {
  if (!isSafeRefId(ref_id)) {
    return { ok: false, message: `Invalid ref_id: must match [A-Za-z0-9_\\-.:@]+ (got ${JSON.stringify(ref_id)})` };
  }
  if (!EDGE_TYPE_PATTERN.test(edge_type)) {
    return {
      ok: false,
      message: `Invalid edge_type: must match [A-Za-z_][A-Za-z0-9_]* (got ${JSON.stringify(edge_type)})`,
    };
  }
  const params = new URLSearchParams({
    expand: "edges",
    edge_type: `["${edge_type}"]`,
    limit: String(EDGE_LOOKUP_LIMIT),
    include_properties: "true",
    canonicalize: "false",
  });
  const result = await jarvisRequest({
    config,
    endpoint: `/v2/nodes/${encodeURIComponent(ref_id)}?${params.toString()}`,
    method: "GET",
  });
  if (!result.ok) {
    return {
      ok: false,
      status: String(result.status),
      message: result.error ?? `Request failed with status ${result.status}`,
    };
  }
  const body = result.body as
    | {
        nodes?: Array<{ ref_id?: unknown; name?: unknown; properties?: Record<string, unknown> }>;
        edges?: Array<{
          ref_id?: unknown;
          source?: unknown;
          target?: unknown;
          edge_type?: unknown;
          properties?: Record<string, unknown>;
        }>;
      }
    | undefined;
  const names = new Map<string, string>();
  for (const n of body?.nodes ?? []) {
    const name = n?.properties?.name ?? n?.properties?.title ?? n?.name;
    if (typeof n?.ref_id === "string" && typeof name === "string" && name) names.set(n.ref_id, name);
  }
  const edges: ExpandedEdge[] = [];
  for (const e of body?.edges ?? []) {
    if (typeof e?.ref_id !== "string" || !e.ref_id) continue;
    if (typeof e.source !== "string" || typeof e.target !== "string" || e.edge_type !== edge_type) continue;
    edges.push({ ref_id: e.ref_id, source: e.source, target: e.target, edge_type, properties: e.properties ?? {} });
  }
  return { ok: true, edges, names };
}

export interface JarvisEdgeMatch {
  ref_id: string;
  properties: Record<string, unknown>;
  source_name?: string;
  target_name?: string;
}

/**
 * Find one edge by its ends and type: `(source)-[:edge_type]->(target)`.
 *
 * Jarvis addresses edges by an opaque `ref_id` that no read tool surfaces to
 * the model, so an approved edge delete or node move resolves the edge here
 * through `GET /v2/nodes/{ref_id}?expand=edges`. The source side is read
 * first; when a hub source cuts the list short, the target side is read too.
 * Muted or soft-deleted edges count as absent.
 *
 * `success: true` without `edge` means the edge is not there. Never throws.
 */
export async function findEdgeByEndpoints(
  config: JarvisConnectionConfig,
  edge: { source_ref_id: string; edge_type: string; target_ref_id: string },
): Promise<JarvisV2Result & { edge?: JarvisEdgeMatch }> {
  const { source_ref_id, edge_type, target_ref_id } = edge;
  for (const side of [source_ref_id, target_ref_id]) {
    const read = await readEdgesOfType(config, side, edge_type);
    if (!read.ok) return { success: false, status: read.status, message: read.message };
    const match = read.edges.find(
      (e) => e.source === source_ref_id && e.target === target_ref_id && !isMutedEdge(e.properties),
    );
    if (match) {
      const source_name = read.names.get(source_ref_id);
      const target_name = read.names.get(target_ref_id);
      return {
        success: true,
        status: "success",
        ref_id: match.ref_id,
        edge: {
          ref_id: match.ref_id,
          properties: match.properties,
          ...(source_name ? { source_name } : {}),
          ...(target_name ? { target_name } : {}),
        },
      };
    }
  }
  return { success: true, status: "success" };
}

export interface JarvisIncomingEdge {
  ref_id: string;
  source_ref_id: string;
  source_name?: string;
  properties: Record<string, unknown>;
}

/**
 * The live edges of one type that point AT a node — its parents along
 * PARENT_OF, say. What a node move reads to learn where the node sits now.
 * Never throws.
 */
export async function listIncomingEdges(
  config: JarvisConnectionConfig,
  args: { ref_id: string; edge_type: string },
): Promise<JarvisV2Result & { edges: JarvisIncomingEdge[] }> {
  const read = await readEdgesOfType(config, args.ref_id, args.edge_type);
  if (!read.ok) return { success: false, status: read.status, message: read.message, edges: [] };
  const edges = read.edges
    .filter((e) => e.target === args.ref_id && e.source !== args.ref_id && !isMutedEdge(e.properties))
    .map((e) => {
      const source_name = read.names.get(e.source);
      return {
        ref_id: e.ref_id,
        source_ref_id: e.source,
        ...(source_name ? { source_name } : {}),
        properties: e.properties,
      };
    });
  return { success: true, status: "success", edges };
}

export interface JarvisGraphEdge {
  source: string;
  target: string;
  edge_type: string;
  properties?: Record<string, unknown>;
}

export interface NodeEdgesResult {
  ok: boolean;
  edges: JarvisGraphEdge[];
  /** The neighbours the edges point at (and the node itself), with properties. */
  nodes: JarvisGraphNode[];
  status?: number;
  error?: string;
}

/** jarvis reads list filters as Python list literals: `["A","B"]`. */
function toListLiteral(values: string[]): string {
  return `[${values.map((v) => JSON.stringify(v)).join(",")}]`;
}

/**
 * A node's edges via `GET /v2/nodes/:ref_id?expand=edges`, raw — no neighbor
 * dedup, so parallel edges of different types all come back. `limit` bounds
 * jarvis' traversal (a hub node can OOM Neo4j without one) and applies AFTER
 * the `nodeTypes` / `edgeTypes` filters, so filter to keep a hub's many
 * irrelevant edges from crowding out the ones wanted.
 *
 * Never throws. Returns `{ ok: false }` on any transport/HTTP failure.
 */
export async function getNodeEdges(
  config: JarvisConnectionConfig,
  refId: string,
  options: { limit?: number; nodeTypes?: string[]; edgeTypes?: string[] } = {},
): Promise<NodeEdgesResult> {
  if (!isSafeRefId(refId)) {
    return { ok: false, edges: [], nodes: [], error: `Invalid ref_id: ${JSON.stringify(refId)}` };
  }
  const params = new URLSearchParams({ expand: "edges", limit: String(options.limit ?? 200) });
  if (options.nodeTypes?.length) params.set("node_type", toListLiteral(options.nodeTypes));
  if (options.edgeTypes?.length) params.set("edge_type", toListLiteral(options.edgeTypes));
  const result = await jarvisRequest({
    config,
    endpoint: `/v2/nodes/${encodeURIComponent(refId)}?${params.toString()}`,
    method: "GET",
  });
  if (!result.ok) return { ok: false, edges: [], nodes: [], status: result.status, error: result.error };
  const body = result.body as { edges?: JarvisGraphEdge[]; nodes?: JarvisGraphNode[] } | undefined;
  return {
    ok: true,
    edges: Array.isArray(body?.edges) ? body!.edges : [],
    nodes: Array.isArray(body?.nodes) ? body!.nodes : [],
    status: result.status,
  };
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
