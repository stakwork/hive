import { queryOptions } from "@tanstack/react-query";
import type { ConnectionItem, ConnectionPageArgs, Hierarchy, NodeConnections } from "@/services/graph/workbench";
import type { GraphNodeTypesResponse, GraphSearchHit, GraphSearchResponse } from "@/types/graph-node";

/**
 * The workbench's reads, as React Query options: a node read twice (selected,
 * then expanded in Graph mode) or a graph re-opened is answered from cache.
 * And its one write, a concept's docs.
 */

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

/** Neighbours per "show more" in one edge group. */
export const CONNECTION_PAGE = 25;

const graphApi = (slug: string) => `/api/workspaces/${encodeURIComponent(slug)}/graph`;

/** Every node of one type, with the edges among them. */
export const hierarchyQuery = (slug: string, type: string) =>
  queryOptions({
    queryKey: ["graph-workbench", slug, "hierarchy", type],
    queryFn: () => getJson<Hierarchy>(`${graphApi(slug)}/hierarchy?label=${encodeURIComponent(type)}`),
  });

/** A node's properties and edge groups. */
export const connectionsQuery = (slug: string, refId: string) =>
  queryOptions({
    queryKey: ["graph-workbench", slug, "connections", refId],
    queryFn: () => getJson<NodeConnections>(`${graphApi(slug)}/connections?ref_id=${encodeURIComponent(refId)}`),
  });

/** The first `limit` neighbours in one of a node's edge groups. */
export const connectionPageQuery = (slug: string, args: ConnectionPageArgs) =>
  queryOptions({
    queryKey: ["graph-workbench", slug, "connection-page", args],
    queryFn: () => {
      const p = new URLSearchParams({
        ref_id: args.refId,
        edge: args.edge,
        outgoing: String(args.outgoing),
        other: args.other,
        limit: String(args.limit),
      });
      return getJson<ConnectionItem[]>(`${graphApi(slug)}/connections/page?${p.toString()}`);
    },
  });

/** The workspace's node types (its graph ontology), sorted by name. */
export const nodeTypesQuery = (slug: string) =>
  queryOptions({
    queryKey: ["graph-workbench", slug, "node-types"],
    queryFn: async () =>
      (await getJson<GraphNodeTypesResponse>(`${graphApi(slug)}/node-types`)).node_types
        .map((t) => t.type)
        .sort((a, b) => a.localeCompare(b)),
  });

/** The swarm's search over one node type. */
export const nodeSearchQuery = (slug: string, type: string, q: string, limit: number) =>
  queryOptions({
    queryKey: ["graph-workbench", slug, "search", type, q, limit],
    queryFn: async (): Promise<GraphSearchHit[]> => {
      const p = new URLSearchParams({ q, limit: String(limit), types: type });
      return (await getJson<GraphSearchResponse>(`${graphApi(slug)}/nodes/search?${p.toString()}`)).results ?? [];
    },
  });

/**
 * Save a concept's docs through the Learn page's endpoint. `key` is the
 * concept's own `id`, not its ref_id: the swarm writes `docs` on the Concept
 * matching that `id`, and matches nothing by ref_id.
 */
export const saveConceptDocs = (slug: string, key: string, documentation: string) =>
  getJson(`/api/learnings/concepts/${encodeURIComponent(key)}/documentation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentation, workspace: slug }),
  });
