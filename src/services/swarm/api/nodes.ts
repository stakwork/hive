import type {
  JarvisConnectionConfig,
  UpdateNodeRequest,
} from "@/types/jarvis";

interface JarvisApiResponse {
  ok: boolean;
  status: number;
  error?: string;
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

    return {
      ok: true,
      status: response.status,
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
      properties: request.properties,
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
