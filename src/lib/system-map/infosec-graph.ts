/**
 * Client for the shared infosec graph (`infosec.sphinx.chat`) — one
 * read-only graph for every workspace, holding the MITRE CWE catalogue.
 * Kept apart from the per-workspace swarm client (`services/swarm/api/nodes`):
 * different host, optional token, read only.
 *
 * Env: `INFOSEC_GRAPH_URL` (default `https://infosec.sphinx.chat/api`) and
 * `INFOSEC_GRAPH_API_KEY`, sent as `x-api-token` when set — every route is
 * free with it; the reads below are free without it too.
 */

export const DEFAULT_INFOSEC_GRAPH_URL = "https://infosec.sphinx.chat/api";
const TIMEOUT_MS = 30_000;

export interface InfosecNode {
  ref_id: string;
  node_type: string;
  properties?: Record<string, unknown>;
}

export interface InfosecEdge {
  source: string;
  target: string;
  edge_type: string;
  properties?: Record<string, unknown>;
}

export class InfosecGraphError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "InfosecGraphError";
  }
}

function baseUrl(): string {
  return (process.env.INFOSEC_GRAPH_URL || DEFAULT_INFOSEC_GRAPH_URL).replace(/\/$/, "");
}

async function get<T>(path: string): Promise<T> {
  const apiKey = process.env.INFOSEC_GRAPH_API_KEY;
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      headers: apiKey ? { "x-api-token": apiKey } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new InfosecGraphError(timedOut ? `no answer in ${TIMEOUT_MS / 1000} s` : "could not be reached");
  }
  if (!response.ok) {
    const said = (await response.json().catch(() => null)) as { error?: { message?: unknown }; message?: unknown } | null;
    const message = typeof said?.error?.message === "string" ? said.error.message : typeof said?.message === "string" ? said.message : null;
    throw new InfosecGraphError(`${response.status}${message ? ` ${message}` : ""}`, response.status);
  }
  return (await response.json()) as T;
}

/** A node's ref_id by its type's unique key (`CWE` / `CWE-79`), or null when absent. `GET /v2/nodes/check`. */
export async function findInfosecNode(nodeType: string, key: string): Promise<string | null> {
  const params = new URLSearchParams({ node_type: nodeType, key });
  const body = await get<{ exists?: boolean; ref_id?: string | null }>(`/v2/nodes/check?${params.toString()}`);
  return body.exists && body.ref_id ? body.ref_id : null;
}

export interface InfosecSearchHit {
  ref_id: string;
  node_type: string;
  title: string;
}

/**
 * Nodes of one type whose title matches `query` (no properties):
 * `GET /v2/nodes/search?q=…&type=…&limit=…`.
 */
export async function searchInfosecNodes(nodeType: string, query: string, limit = 20): Promise<InfosecSearchHit[]> {
  const params = new URLSearchParams({ q: query, type: nodeType, limit: String(limit) });
  const body = await get<{ nodes?: InfosecSearchHit[] }>(`/v2/nodes/search?${params.toString()}`);
  return Array.isArray(body.nodes) ? body.nodes.filter((n) => n && typeof n.ref_id === "string") : [];
}

/**
 * A node's edges of the given types, with the node and its neighbours (full
 * properties): `GET /v2/nodes/:ref_id?expand=edges&edge_type=[…]`. The filter
 * runs in jarvis, so a hub's other edges never come back.
 */
export async function expandInfosecNode(
  refId: string,
  edgeTypes: string[],
  limit = 1000,
): Promise<{ nodes: InfosecNode[]; edges: InfosecEdge[] }> {
  const params = new URLSearchParams({
    expand: "edges",
    limit: String(limit),
    edge_type: `[${edgeTypes.map((t) => JSON.stringify(t)).join(",")}]`,
  });
  const body = await get<{ nodes?: InfosecNode[]; edges?: InfosecEdge[] }>(
    `/v2/nodes/${encodeURIComponent(refId)}?${params.toString()}`,
  );
  return { nodes: Array.isArray(body.nodes) ? body.nodes : [], edges: Array.isArray(body.edges) ? body.edges : [] };
}
