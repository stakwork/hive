import { searchNodesByAttributes, type JarvisGraphNode } from "@/services/swarm/api/nodes";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import type { ProtectEndpoint } from "@/types/protect";

export const ENDPOINT_NODE_TYPE = "Endpoint";

const ENDPOINT_LIMIT = 5000;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseProtectEndpoint(node: JarvisGraphNode): ProtectEndpoint | null {
  if (!node.ref_id) return null;
  const properties = node.properties ?? {};
  return {
    refId: node.ref_id,
    name: asString(properties.name),
    verb: asString(properties.verb).toUpperCase(),
    file: asString(properties.file),
  };
}

export type ListProtectEndpointsResult =
  | { ok: true; endpoints: ProtectEndpoint[]; truncated: boolean }
  | { ok: false; endpoints: []; error: string; status?: number };

/**
 * List Endpoint nodes for a workspace swarm.
 *
 * Stakgraph writes code nodes as `:Data_Bank:Endpoint` without the `:Node`
 * label, so `GET /v2/nodes` never matches them — the attributes search does.
 */
export async function listProtectEndpoints(
  config: JarvisConnectionConfig,
): Promise<ListProtectEndpointsResult> {
  const result = await searchNodesByAttributes(config, {
    nodeTypes: [ENDPOINT_NODE_TYPE],
    filters: [],
    includeProperties: true,
    limit: ENDPOINT_LIMIT,
  });
  if (!result.ok) {
    return {
      ok: false,
      endpoints: [],
      error: result.error || "Failed to load endpoints",
      status: result.status,
    };
  }

  const endpoints = result.nodes
    .map(parseProtectEndpoint)
    .filter((endpoint): endpoint is ProtectEndpoint => endpoint !== null)
    .sort((a, b) => a.name.localeCompare(b.name) || a.verb.localeCompare(b.verb));

  return { ok: true, endpoints, truncated: result.nodes.length >= ENDPOINT_LIMIT };
}
