import type { EndpointNode } from "@/lib/vercel/path-matcher";

/**
 * How long a non-empty Endpoint list is reused. Endpoint nodes only change when a stakgraph
 * sync lands, and `GET /nodes?node_type=Endpoint` scans every Endpoint node on the swarm, so
 * the drain must not re-ask for it on every log batch (batches arrive every few seconds while
 * anyone is using the app).
 */
export const ENDPOINT_CACHE_TTL_MS = 10 * 60_000;

/**
 * How long an empty or failed lookup is remembered. A swarm mid-ingest, or one whose Neo4j is
 * lock-bound, must be retried, but once a minute, not back to back on every batch.
 */
export const ENDPOINT_EMPTY_CACHE_TTL_MS = 60_000;

/** Upper bound on one `GET /nodes` round trip; a lock-bound swarm must not pin the handler. */
export const ENDPOINT_FETCH_TIMEOUT_MS = 20_000;

export const endpointCache = new Map<string, { nodes: EndpointNode[]; expiresAt: number }>();
export const inflight = new Map<string, Promise<EndpointNode[]>>();

export function resetEndpointCache(): void {
  endpointCache.clear();
  inflight.clear();
}
