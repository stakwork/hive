import type { Hierarchy } from "@/services/graph/workbench";
import type { NodeEdit } from "./changes";

/** The default tree: Concepts along `(parent)-[:PARENT_OF]->(child)`. */
export const DEFAULT_TREE = { type: "Concept", edge: "PARENT_OF" } as const;

/** What makes a tree: nodes of one type, and the edge type that runs from parent to child. */
export interface TreeLens {
  type: string;
  edge: string;
}

export interface WorkbenchNode {
  id: string;
  /** The node's own `id` property (a concept's gitree id). */
  key: string | null;
  name: string;
  type: string;
  description: string | null;
  docs: string | null;
  repo: string | null;
  reads: number;
  approvers: string[];
  /** Has children and no parent. Inferred — the graph stores no root flag. */
  root: boolean;
  /** Part of a proposal being previewed: a node it would create, or one it would change (`edit`). */
  proposed?: "new" | "changed" | "removed";
  edit?: NodeEdit;
}

export interface WorkbenchGraph {
  /** The lens the trees were built along — its edge is one these nodes use (see `buildGraph`). */
  lens: TreeLens;
  nodes: Record<string, WorkbenchNode>;
  /** Built once along `lens.edge`: parent ids by child, child ids by parent. */
  parents: Record<string, string[]>;
  children: Record<string, string[]>;
  /** How many edges of each type run between nodes of this type — the edges a tree could follow. */
  edgeTypes: Array<{ type: string; count: number }>;
}

const push = (map: Record<string, string[]>, key: string, value: string) => {
  (map[key] ??= []).push(value);
};

/** Has children and no parent. */
export const isRoot = (parents: Record<string, string[]>, children: Record<string, string[]>, id: string) =>
  !parents[id]?.length && !!children[id]?.length;

/**
 * The trees of `lens.type` nodes. They follow `lens.edge` when these nodes use
 * it, else PARENT_OF when they do, else their most common edge; `lens` on the
 * result says which.
 */
export function buildGraph(h: Hierarchy, lens: TreeLens): WorkbenchGraph {
  const nodes: Record<string, WorkbenchNode> = {};
  for (const n of h.nodes) nodes[n.id] = { ...n, type: lens.type, root: false };
  const between = h.edges.filter((e) => nodes[e.source] && nodes[e.target] && e.source !== e.target);
  const counts = new Map<string, number>();
  for (const e of between) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  const edgeTypes = [...counts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
  const edge = [lens.edge, DEFAULT_TREE.edge].find((e) => counts.has(e)) ?? edgeTypes[0]?.type ?? lens.edge;

  const parents: Record<string, string[]> = {};
  const children: Record<string, string[]> = {};
  for (const e of between) {
    if (e.type !== edge) continue;
    push(children, e.source, e.target);
    push(parents, e.target, e.source);
  }
  const byName = (a: string, b: string) => nodes[a].name.localeCompare(nodes[b].name);
  for (const list of [...Object.values(children), ...Object.values(parents)]) list.sort(byName);
  for (const n of Object.values(nodes)) n.root = isRoot(parents, children, n.id);
  return { lens: { type: lens.type, edge }, nodes, parents, children, edgeTypes };
}

export const parentsOf = (g: WorkbenchGraph, id: string) => g.parents[id] ?? [];
export const childrenOf = (g: WorkbenchGraph, id: string) => g.children[id] ?? [];
export const neighboursOf = (g: WorkbenchGraph, id: string) => [...parentsOf(g, id), ...childrenOf(g, id)];

/** Every path from a root down to `id`, root first. Cycle-safe. */
export function pathsToRoot(g: WorkbenchGraph, id: string, seen: ReadonlySet<string> = new Set()): string[][] {
  if (seen.has(id)) return [];
  const parents = parentsOf(g, id);
  if (parents.length === 0) return [[id]];
  const next = new Set(seen).add(id);
  return parents.flatMap((p) => pathsToRoot(g, p, next).map((path) => [...path, id]));
}

/** One path from a root down to `id`, root first: the first one `pathsToRoot` would list, without listing them all. */
export function pathToRoot(g: WorkbenchGraph, id: string, seen = new Set<string>()): string[] | null {
  if (seen.has(id)) return null;
  const parents = parentsOf(g, id);
  if (parents.length === 0) return [id];
  seen.add(id);
  for (const p of parents) {
    const path = pathToRoot(g, p, seen);
    if (path) return [...path, id];
  }
  return null;
}

/** Everything reachable from `from` by repeatedly following `next`. */
export function reach(g: WorkbenchGraph, from: string, next: (g: WorkbenchGraph, id: string) => string[]): Set<string> {
  const out = new Set<string>();
  const queue = [from];
  while (queue.length) {
    for (const n of next(g, queue.pop()!)) {
      if (!out.has(n)) {
        out.add(n);
        queue.push(n);
      }
    }
  }
  return out;
}

/** Roots, biggest tree first. */
export function rootsOf(g: WorkbenchGraph): Array<{ node: WorkbenchNode; size: number }> {
  return Object.values(g.nodes)
    .filter((n) => n.root)
    .map((node) => ({ node, size: reach(g, node.id, childrenOf).size }))
    .sort((a, b) => b.size - a.size || a.node.name.localeCompare(b.node.name));
}

interface HealthGroup {
  key: "unplaced" | "multiParent" | "emptyDocs" | "unread";
  label: string;
  hint: string;
  ids: string[];
}

/** Docs this short tell an agent nothing. */
const MIN_DOCS = 20;

export const hasDocs = (n: WorkbenchNode) => (n.docs?.trim().length ?? 0) >= MIN_DOCS;

export function health(g: WorkbenchGraph): HealthGroup[] {
  const nodes = Object.values(g.nodes).sort((a, b) => a.name.localeCompare(b.name));
  return [
    {
      key: "unplaced",
      label: "Not in any tree",
      hint: "No parent and no children, so walking a tree never reaches them.",
      ids: nodes.filter((n) => !parentsOf(g, n.id).length && !childrenOf(g, n.id).length).map((n) => n.id),
    },
    {
      key: "multiParent",
      label: "Several parents",
      hint: "Sometimes right, often a misfiled link.",
      ids: nodes.filter((n) => parentsOf(g, n.id).length > 1).map((n) => n.id),
    },
    {
      key: "emptyDocs",
      label: "Empty docs",
      hint: "An agent that reads these learns nothing.",
      ids: nodes.filter((n) => !hasDocs(n)).map((n) => n.id),
    },
    {
      key: "unread",
      label: "Never read",
      hint: "No run or session has read these.",
      ids: nodes.filter((n) => n.reads === 0).map((n) => n.id),
    },
  ];
}
