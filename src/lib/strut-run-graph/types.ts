/**
 * The graph trace of a strut run: every call that touched the knowledge
 * graph, in the order the run made them, and the nodes those calls touched.
 *
 * Generic over workflows — nothing here knows what the run was for. A call
 * is any `step.end` in strut's event log that carries `nodes` (strut's
 * provenance marker, `withAccessedNodes`), whether the workflow ran the step
 * or an agent inside it called it as a tool.
 *
 * Strut marks a search with every node it matched. Those are hits, not
 * reads: the call is kept, its hits are counted, and a hit is a node of the
 * trace only when another call went on to read or write it.
 */

/** A node as strut's event log names it. */
export interface RunGraphNodeRef {
  ref_id: string;
  node_type?: string;
}

export type RunGraphAccess = "read" | "write";

export type RunGraphQueryValue = string | number | boolean | string[];

export interface RunGraphCall {
  /** The call's event path — unique within a run, and its place in the tree. */
  path: string;
  /** Step type without the `tool:` prefix: `graph/graph-get`, `graph_graph_get`. */
  tool: string;
  /** Who made the call: an agent (a `tool:` event) or the workflow itself. */
  by: "agent" | "workflow";
  access: RunGraphAccess;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  /** What the call asked for — scalar query fields only, never node payloads. */
  query: Record<string, RunGraphQueryValue>;
  /** The nodes the call read or wrote; none for a search. */
  nodes: RunGraphNodeRef[];
  /** On a search: how many nodes it matched. */
  hits?: number;
}

/** A touched node, resolved against the graph the run used. */
export interface RunGraphNode {
  ref_id: string;
  node_type: string;
  name: string;
  namespace: string | null;
  /** False when the graph no longer holds the node (deleted, or another database). */
  found: boolean;
}

/** One node read whole, for reading what the run read: its labels, and every property but the vectors. */
export interface RunGraphNodeBody {
  ref_id: string;
  node_type: string;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface RunGraphEdge {
  source: string;
  target: string;
  edge_type: string;
}

export interface RunGraphTrace {
  calls: RunGraphCall[];
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
  /** False when the graph did not answer for the nodes: they are then as the run's log named them. */
  nodesRead: boolean;
  /** False when the graph did not answer for the edges: `edges` is then empty, not known to be. */
  edgesRead: boolean;
  /** Why the graph did not answer (`400 query too long`): for the nodes, else for the edges. */
  unreadReason?: string;
  /** True when the run touched more nodes than were resolved. */
  truncated: boolean;
}
