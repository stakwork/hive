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
): Promise<{ success: boolean; ref_id?: string; alreadyExists?: boolean; error?: string }> {
  const result = await jarvisRequest({
    config,
    endpoint: "/node",
    method: "POST",
    data: payload,
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

export async function addEdge(
  config: JarvisConnectionConfig,
  payload: {
    edge: { edge_type: string; edge_data?: Record<string, unknown> };
    source: { ref_id: string };
    target: { ref_id: string };
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
    source: { ref_id: string };
    target: { ref_id: string };
  }>,
): Promise<{ success: boolean; errors: string[] }> {
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
