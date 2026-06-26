import type {
  JarvisConnectionConfig,
  UpdateNodeRequest,
} from "@/types/jarvis";

interface JarvisApiResponse {
  ok: boolean;
  status: number;
  error?: string;
  body?: unknown;
}

async function jarvisRequest({
  config,
  endpoint,
  method = "GET",
  data,
}: {
  config: JarvisConnectionConfig;
  endpoint: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  data?: unknown;
}): Promise<JarvisApiResponse> {
  try {
    const url = `${config.jarvisUrl.replace(/\/$/, "")}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

    const headers: Record<string, string> = {
      "x-api-token": config.apiKey,
      "Content-Type": "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      ...(data ? { body: JSON.stringify(data) } : {}),
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.error("[Jarvis Nodes] Request failed:", response.status, responseText);
      return {
        ok: false,
        status: response.status,
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
    console.error("[Jarvis Nodes] Request error:", error);
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
    endpoint: "/node",
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

export async function addEdgeBulk(
  config: JarvisConnectionConfig,
  edgeList: Array<{
    edge: { edge_type: string; weight?: number; edge_data?: Record<string, unknown> };
    source: JarvisEdgeEndpoint;
    target: JarvisEdgeEndpoint;
  }>,
): Promise<{ success: boolean; errors: string[] }> {
  if (edgeList.length === 0) return { success: true, errors: [] };
  const result = await jarvisRequest({
    config,
    endpoint: "/node/edge/bulk",
    method: "POST",
    data: { edge_list: edgeList },
  });

  if (!result.ok) {
    return {
      success: false,
      errors: [result.error || `Failed to create edges (status: ${result.status})`],
    };
  }

  const body = result.body as
    | { status?: string; status_messages?: string[] }
    | undefined;

  const errors = (body?.status_messages ?? []).filter((m) =>
    m.toLowerCase().startsWith("error"),
  );

  return {
    success: body?.status?.toLowerCase() === "success",
    errors,
  };
}

/**
 * Bulk create-or-merge nodes in a single request (Jarvis `/node/bulk`).
 * With `reprocess: true`, existing nodes (matched by node_key) are updated in
 * place. Jarvis processes the list sequentially in one Neo4j session, so this
 * collapses many round-trips into one HTTP call. Errors are returned, never
 * thrown. Callers should chunk large lists (see BULK_CHUNK in the mirror cron).
 */
export async function addNodeBulk(
  config: JarvisConnectionConfig,
  nodes: Array<{ node_type: string; node_data: Record<string, unknown> }>,
  opts?: { reprocess?: boolean },
): Promise<{ success: boolean; errors: string[] }> {
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

/**
 * Read nodes of the given types via `POST /graph/search/latest-by-types`,
 * newest-ingested-first (ordered `date_added_to_graph` DESC). The endpoint has
 * no hard cap — it returns up to the requested per-type limit or the real total,
 * whichever is smaller. `withProperties` is required to read schema properties
 * (e.g. a PullRequest's `number`/`repo`), at the cost of heavier payloads.
 * Returns `[]` on any error (never throws).
 */
export async function searchLatestByTypes(
  config: JarvisConnectionConfig,
  nodeTypes: Record<string, number>,
  opts?: { withProperties?: boolean },
): Promise<JarvisGraphNode[]> {
  const result = await jarvisRequest({
    config,
    endpoint: "/graph/search/latest-by-types",
    method: "POST",
    data: { nodeTypes, include_properties: opts?.withProperties ?? false },
  });

  if (!result.ok) return [];

  const body = result.body as { nodes?: JarvisGraphNode[] } | undefined;
  return Array.isArray(body?.nodes) ? body!.nodes : [];
}

export async function updateNode(
  config: JarvisConnectionConfig,
  request: UpdateNodeRequest,
): Promise<{ success: boolean; error?: string }> {
  const result = await jarvisRequest({
    config,
    endpoint: "/node",
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
): Promise<{ success: boolean; error?: string }> {
  try {
    const url = `${config.jarvisUrl.replace(/\/$/, "")}/node/edge/${encodeURIComponent(edgeRefId)}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "x-api-token": config.apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.error("[Jarvis Nodes] deleteEdge failed:", response.status, responseText);
      return {
        success: false,
        error: `Request failed with status ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    console.error("[Jarvis Nodes] deleteEdge error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}
