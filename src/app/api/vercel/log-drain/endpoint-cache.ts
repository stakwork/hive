import type { EndpointNode } from "@/lib/vercel/path-matcher";

export const ENDPOINT_CACHE_TTL_MS = 60_000;

export const endpointCache = new Map<string, { nodes: EndpointNode[]; expiresAt: number }>();
export const inflight = new Map<string, Promise<EndpointNode[]>>();

export function resetEndpointCache(): void {
  endpointCache.clear();
  inflight.clear();
}
