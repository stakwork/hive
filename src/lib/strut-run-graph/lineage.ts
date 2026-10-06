/**
 * A node's lineage: the nodes above it along `PARENT_OF`, up to the root of
 * its tree — a Concept's parents up to `Medicine`, a class's up to the one it
 * all derives from. Pure; the server reads it, the viewer draws it.
 */

import type { RunGraphEdge } from "./types";

/** The edge a lineage runs along, parent → child. */
export const LINEAGE_EDGE_TYPE = "PARENT_OF";

export function isLineageEdge(edge: RunGraphEdge): boolean {
  return edge.edge_type === LINEAGE_EDGE_TYPE;
}

/** Each node's parents along the lineage edges, in the order the edges name them. */
export function lineageParents(edges: RunGraphEdge[]): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    if (!isLineageEdge(edge) || edge.source === edge.target) continue;
    const list = parents.get(edge.target);
    if (!list) parents.set(edge.target, [edge.source]);
    else if (!list.includes(edge.source)) list.push(edge.source);
  }
  return parents;
}

/** Everything above `ids`, nearest first — never one of `ids` itself. */
export function ancestorsOf(ids: Iterable<string>, parents: ReadonlyMap<string, string[]>): string[] {
  const seen = new Set<string>(ids);
  const ancestors: string[] = [];
  const queue = [...seen];
  for (let i = 0; i < queue.length; i++) {
    for (const parent of parents.get(queue[i]) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      ancestors.push(parent);
      queue.push(parent);
    }
  }
  return ancestors;
}
