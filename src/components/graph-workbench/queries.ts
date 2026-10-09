import { queryOptions } from "@tanstack/react-query";
import type { WorkspaceRole } from "@/lib/auth/roles";
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

/** Every read of one workspace's graph: invalidate it when that graph changes. */
export const workbenchKey = (slug: string) => ["graph-workbench", slug] as const;

const graphApi = (slug: string) => `/api/workspaces/${encodeURIComponent(slug)}/graph`;

/** Every node of one type, with the edges among them. */
export const hierarchyQuery = (slug: string, type: string) =>
  queryOptions({
    queryKey: [...workbenchKey(slug), "hierarchy", type],
    queryFn: () => getJson<Hierarchy>(`${graphApi(slug)}/hierarchy?label=${encodeURIComponent(type)}`),
  });

/** A node's properties and edge groups. */
export const connectionsQuery = (slug: string, refId: string) =>
  queryOptions({
    queryKey: [...workbenchKey(slug), "connections", refId],
    queryFn: () => getJson<NodeConnections>(`${graphApi(slug)}/connections?ref_id=${encodeURIComponent(refId)}`),
  });

/** The first `limit` neighbours in one of a node's edge groups. */
export const connectionPageQuery = (slug: string, args: ConnectionPageArgs) =>
  queryOptions({
    queryKey: [...workbenchKey(slug), "connection-page", args],
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
    queryKey: [...workbenchKey(slug), "node-types"],
    queryFn: async () =>
      (await getJson<GraphNodeTypesResponse>(`${graphApi(slug)}/node-types`)).node_types
        .map((t) => t.type)
        .sort((a, b) => a.localeCompare(b)),
  });

/** The swarm's search over one node type. */
export const nodeSearchQuery = (slug: string, type: string, q: string, limit: number) =>
  queryOptions({
    queryKey: [...workbenchKey(slug), "search", type, q, limit],
    queryFn: async (): Promise<GraphSearchHit[]> => {
      const p = new URLSearchParams({ q, limit: String(limit), types: type });
      return (await getJson<GraphSearchResponse>(`${graphApi(slug)}/nodes/search?${p.toString()}`)).results ?? [];
    },
  });

/** The caller's role in the workspace: only developers and up may edit its graph. */
export const workspaceRoleQuery = (slug: string) =>
  queryOptions({
    queryKey: ["workspace-role", slug],
    queryFn: async () =>
      (await getJson<{ workspace: { userRole: WorkspaceRole } }>(`/api/workspaces/${encodeURIComponent(slug)}`))
        .workspace.userRole,
    // Roles change rarely; don't re-read it for every node opened.
    staleTime: Infinity,
  });

/**
 * Save a Concept's docs straight to the graph, addressed by its `ref_id`. This
 * works for any Concept, including ones without a gitree `id` (the Learn
 * page's endpoint is keyed by that slug, and the swarm matches nothing by ref_id).
 */
export const saveConceptDocs = (slug: string, refId: string, documentation: string) =>
  getJson(`${graphApi(slug)}/node/${encodeURIComponent(refId)}/docs`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docs: documentation }),
  });
