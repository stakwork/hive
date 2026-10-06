import type { GraphChange } from "./changes";
import { isRoot, type WorkbenchGraph, type WorkbenchNode } from "./model";

/**
 * A proposal drawn over the graph, before anyone approves it. The nodes it
 * would create or change are marked on the node itself (`proposed`, `edit`);
 * this is the rest.
 */
export interface Pending {
  /** Tree edges that would be added, as "source>target". */
  newEdges: Set<string>;
  /** Tree edges that would be removed, as "source>target". They stay in the graph, drawn as going. */
  removedEdges: Set<string>;
  /** Links of any other edge type that would be added. */
  links: Array<{ edge: string; source: string; target: string }>;
  /** Links of any other edge type that would be removed. */
  unlinks: Array<{ edge: string; source: string; target: string }>;
  /** Every node a change touches — the canvas keeps them all in view. */
  touched: Set<string>;
  /** Where the canvas should centre: what the first change is about. */
  focus: string | null;
  /** How many nodes it would create, how many it would change, and how many it would delete. */
  created: number;
  edited: number;
  removed: number;
}

const emptyPending = (): Pending => ({
  newEdges: new Set(),
  removedEdges: new Set(),
  links: [],
  unlinks: [],
  touched: new Set(),
  focus: null,
  created: 0,
  edited: 0,
  removed: 0,
});

export const NO_PENDING = emptyPending();

/** A node by its ref_id, its own id (a concept's gitree id), or its name — the ways proposals address one. */
export function findNode(g: WorkbenchGraph, ref: string): string | null {
  if (g.nodes[ref]) return ref;
  const all = Object.values(g.nodes);
  const byKey = all.find((n) => n.key === ref);
  if (byKey) return byKey.id;
  const lower = ref.toLowerCase();
  return all.find((n) => n.name.toLowerCase() === lower)?.id ?? null;
}

/**
 * The graph with a proposal's changes laid over it: new nodes and edges added
 * (an endpoint that resolves to nothing becomes a new node), edges to remove
 * marked (they stay in the graph, so the tree still shows where the node
 * is), edits recorded. The loaded graph is left as it was.
 */
export function applyChanges(
  base: WorkbenchGraph,
  changes: GraphChange[] | undefined,
): { graph: WorkbenchGraph; pending: Pending } {
  if (!changes?.length) return { graph: base, pending: NO_PENDING };
  const nodes: Record<string, WorkbenchNode> = { ...base.nodes };
  const parents: Record<string, string[]> = { ...base.parents };
  const children: Record<string, string[]> = { ...base.children };
  const graph: WorkbenchGraph = { ...base, nodes, parents, children };
  const pending = emptyPending();

  const addNode = (name: string, extra: Partial<WorkbenchNode> = {}): string => {
    const id = `pending:${pending.created++}`;
    nodes[id] = {
      id,
      key: null,
      name,
      type: base.lens.type,
      description: null,
      docs: null,
      repo: null,
      reads: 0,
      approvers: [],
      root: false,
      proposed: "new",
      ...extra,
    };
    return id;
  };
  const resolveOrAdd = (ref: string) => findNode(graph, ref) ?? addNode(ref);
  const link = (parent: string, child: string) => {
    children[parent] = [...(children[parent] ?? []), child];
    parents[child] = [...(parents[child] ?? []), parent];
    pending.newEdges.add(`${parent}>${child}`);
  };
  const touch = (...ids: string[]) => {
    ids.forEach((id) => pending.touched.add(id));
    pending.focus ??= ids[0];
  };

  for (const change of changes) {
    switch (change.kind) {
      case "node": {
        const parent = change.parent ? findNode(graph, change.parent) : null;
        const id = addNode(change.name, {
          type: change.type ?? base.lens.type,
          description: change.description ?? null,
          docs: change.docs ?? null,
        });
        // A new node's parent link is PARENT_OF; it only shapes a tree drawn along that edge.
        if (parent && base.lens.edge === "PARENT_OF") link(parent, id);
        // The new node comes first so the canvas lands on it; the parent is touched too, so it stays pinned beside it.
        if (parent) touch(id, parent);
        else touch(id);
        break;
      }
      case "docs":
      case "edit": {
        const id = findNode(graph, change.node);
        if (!id) break;
        if (!nodes[id].edit) pending.edited++;
        const edit = { kind: change.kind, before: change.before, after: change.after };
        nodes[id] = { ...nodes[id], proposed: nodes[id].proposed ?? "changed", edit };
        touch(id);
        break;
      }
      case "edge": {
        const source = resolveOrAdd(change.source);
        const target = resolveOrAdd(change.target);
        if (change.edge === base.lens.edge) link(source, target);
        else pending.links.push({ edge: change.edge, source, target });
        touch(source, target);
        break;
      }
      case "unlink": {
        const source = findNode(graph, change.source);
        const target = findNode(graph, change.target);
        // An edge to remove is drawn between two loaded nodes; an end that isn't loaded leaves only the other in view.
        if (source && target) {
          if (change.edge === base.lens.edge) pending.removedEdges.add(`${source}>${target}`);
          else pending.unlinks.push({ edge: change.edge, source, target });
        }
        const known = [source, target].filter((id): id is string => !!id);
        if (known.length) touch(...known);
        break;
      }
      case "remove": {
        // Counted even when the node isn't loaded — a removal the canvas can't draw is still a removal.
        pending.removed++;
        const id = findNode(graph, change.node);
        if (!id) break;
        nodes[id] = { ...nodes[id], proposed: "removed" };
        touch(id);
        break;
      }
    }
  }
  // New links can make or unmake a root.
  for (const id of pending.touched) nodes[id] = { ...nodes[id], root: isRoot(parents, children, id) };
  return { graph, pending };
}
