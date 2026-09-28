/**
 * The graph trace of a strut run: every call that touched the knowledge
 * graph, in the order the run made them, and the nodes those calls touched.
 *
 * Generic over workflows — nothing here knows what the run was for. A call
 * is any `step.end` in strut's event log that carries `nodes` (strut's
 * provenance marker, `withAccessedNodes`), whether the workflow ran the step
 * or an agent inside it called it as a tool.
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
  nodes: RunGraphNodeRef[];
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

export interface RunGraphEdge {
  source: string;
  target: string;
  edge_type: string;
}

export interface RunGraphTrace {
  calls: RunGraphCall[];
  nodes: RunGraphNode[];
  edges: RunGraphEdge[];
  /** False when the graph did not answer for the edges: `edges` is then empty, not known to be. */
  edgesRead: boolean;
  /** True when the run touched more nodes than were resolved. */
  truncated: boolean;
}
