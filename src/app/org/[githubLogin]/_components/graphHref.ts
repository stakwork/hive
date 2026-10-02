import { DEFAULT_TREE } from "@/components/graph-workbench/model";

/** Where the org page's graph view opens: a workspace's graph, on a node's tree. */
export interface GraphLocation {
  workspace?: string | null;
  /** The node to centre on: its ref_id (its own id or name also resolve). */
  refId?: string | null;
  /** The node's type, which picks the tree it opens in. */
  type?: string | null;
}

/**
 * The graph view's params, over `base` so the page's other params stay. An
 * absent value is removed; the default tree's type is left implicit.
 */
export function graphParams(location: GraphLocation, base?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(base);
  const put = (key: string, value: string | null | undefined) => (value ? params.set(key, value) : params.delete(key));
  params.set("view", "graph");
  put("workspace", location.workspace);
  put("type", location.type === DEFAULT_TREE.type ? null : location.type);
  put("ref_id", location.refId);
  return params;
}

/** A link to the org page's graph view. */
export const orgGraphHref = (githubLogin: string, location: GraphLocation) =>
  `/org/${githubLogin}?${graphParams(location).toString()}`;
