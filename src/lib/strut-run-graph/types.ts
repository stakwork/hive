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
 *
 * A touched node is read with its lineage: the nodes above it along
 * `PARENT_OF` (a Concept's parents up to the root of its tree), so the viewer
 * can draw it where it belongs. An ancestor no call touched is in `nodes`
 * too, marked as such.
 */

/** A node as strut's event log names it. */
export interface RunGraphNodeRef {
  /** The trace's id: the graph's ref id, or `@<slug>:<ref_id>` for a node in a peer's graph (`peer-ref.ts`). */
  ref_id: string;
  node_type?: string;
  /** Set for a node in ANOTHER workspace's graph: that workspace's slug (strut's peer id). */
  peer?: string;
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
  /**
   * Set on a call that ran a workflow as a run of its own — `meta/run-workflow`
   * on this strut, `strut/run-workflow` on a peer's — whose nodes it carries
   * folded. Its own calls are loaded on demand, under this call's path
   * (`GET …/graph/calls?under=<path>`); the run id stays on the server.
   */
  child?: RunGraphChild;
}

/** The run a call launched: its workflow, and the peer workspace it ran on, if not this one's strut. */
export interface RunGraphChild {
  workflow: string;
  peer?: string;
}

/** A touched node, resolved against the graph the run used. */
export interface RunGraphNode {
  ref_id: string;
  node_type: string;
  name: string;
  namespace: string | null;
  /** False when the graph no longer holds the node (deleted, or another database). */
  found: boolean;
  /** True for a node no call touched: it is here as an ancestor, along `PARENT_OF`, of one that was. */
  ancestor?: true;
  /** Set for a node in ANOTHER workspace's graph — a peer's run touched it: that workspace's slug. */
  peer?: string;
}

/** A peer workspace whose graph a run reached through another strut, and whether it was read for this viewer. */
export interface RunGraphPeer {
  slug: string;
  /** True when its graph answered for its nodes. */
  read: boolean;
  /** Why not: not a member, not in this org, its swarm unreachable, the graph's own answer. */
  reason?: string;
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
  /** False when the graph did not answer for the lineage: the touched nodes are then without their ancestors. */
  lineageRead: boolean;
  /** Why the graph did not answer (`400 query too long`): for the nodes, else the edges, else the lineage. */
  unreadReason?: string;
  /** True when the run touched more nodes than were resolved. */
  truncated: boolean;
  /**
   * The peer workspaces whose graphs the run reached, each read only for a
   * viewer who is a member of it. The flags above are about the run's own graph.
   */
  peers?: RunGraphPeer[];
}
