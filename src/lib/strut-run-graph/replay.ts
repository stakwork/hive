/**
 * Client-side reading of a run's graph trace: the call tree, and what the
 * graph looked like at each step of a replay. Pure.
 */

import { isLineageEdge } from "./lineage";
import type { RunGraphCall, RunGraphEdge, RunGraphTrace } from "./types";

const edgeKey = (edge: RunGraphEdge): string => `${edge.source}|${edge.edge_type}|${edge.target}`;

/**
 * A refresh of the trace the graph did not answer keeps what an earlier one
 * read of it: the nodes it had resolved, its edges, and the lineage above
 * its nodes.
 */
export function keepGraphRead(prev: RunGraphTrace | null, next: RunGraphTrace): RunGraphTrace {
  if (!prev) return next;
  let kept = next;
  if (next.nodesRead === false && prev.nodesRead) {
    const resolved = new Map(prev.nodes.filter((n) => n.found).map((n) => [n.ref_id, n]));
    kept = { ...kept, nodes: next.nodes.map((n) => resolved.get(n.ref_id) ?? n) };
  }
  if (next.edgesRead === false && prev.edgesRead) kept = { ...kept, edges: prev.edges };
  if (next.lineageRead === false && prev.lineageRead) {
    const has = new Set(kept.nodes.map((n) => n.ref_id));
    const known = new Set(kept.edges.map(edgeKey));
    kept = {
      ...kept,
      nodes: [...kept.nodes, ...prev.nodes.filter((n) => n.ancestor && !has.has(n.ref_id))],
      edges: [...kept.edges, ...prev.edges.filter((e) => isLineageEdge(e) && !known.has(edgeKey(e)))],
    };
  }
  return kept;
}

export interface RunGraphTreeNode {
  /** Path from the run root to this node. */
  path: string;
  /** This node's own path segment. */
  label: string;
  children: RunGraphTreeNode[];
  /** Index into the trace's `calls` when this node is a call. */
  callIndex: number | null;
  /** Calls at or under this node. */
  callCount: number;
}

/** `012-graph_graph_get` → `graph_graph_get`: the counter orders the log, the tree already does. */
export function callLabel(segment: string): string {
  return segment.replace(/^\d{3}-/, "");
}

/**
 * The calls as a tree of their event paths: the run, then each step (and
 * loop iteration, subflow, agent) down to the call. Siblings keep the order
 * of their first call.
 */
export function buildRunGraphTree(calls: RunGraphCall[]): RunGraphTreeNode | null {
  if (calls.length === 0) return null;
  const rootLabel = calls[0].path.split("/")[0];
  const root: RunGraphTreeNode = { path: rootLabel, label: rootLabel, children: [], callIndex: null, callCount: 0 };
  calls.forEach((call, index) => {
    const segments = call.path.split("/");
    let node = root;
    node.callCount++;
    for (let i = 1; i < segments.length; i++) {
      const path = segments.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.path === path);
      if (!child) {
        child = { path, label: segments[i], children: [], callIndex: null, callCount: 0 };
        node.children.push(child);
      }
      child.callCount++;
      node = child;
    }
    node.callIndex = index;
  });
  return root;
}

/**
 * The calls at or under one branch of the run — `scope` is its path under
 * the run, `loop#1/run` — re-rooted at that branch, so the tree, the lanes
 * and the replay read the branch as a run of its own. Null is the whole run.
 */
export function scopeCalls(calls: RunGraphCall[], scope: string | null): RunGraphCall[] {
  if (!scope) return calls;
  const depth = scope.split("/").length;
  const scoped: RunGraphCall[] = [];
  for (const call of calls) {
    const segments = call.path.split("/");
    if (segments.slice(1, depth + 1).join("/") !== scope) continue;
    scoped.push({ ...call, path: segments.slice(depth).join("/") });
  }
  return scoped;
}

/**
 * The scope a branch of the tree opens: its path under the run, given the
 * scope the tree is drawn in (whose last segment is the tree's root).
 */
export function scopeOfBranch(scope: string | null, branchPath: string): string {
  const segments = branchPath.split("/");
  return scope ? [...scope.split("/").slice(0, -1), ...segments].join("/") : segments.slice(1).join("/");
}

export interface ReplayFrame {
  /** Nodes no call has touched yet at this step. */
  hidden: Set<string>;
  /** Nodes the step's own call touched. */
  active: Set<string>;
}

/**
 * The graph at step `step` of a replay (0-based, inclusive): everything
 * touched so far is shown, the current call's nodes are active. A `step`
 * past the last call shows the whole run with nothing active.
 */
export function replayFrame(calls: RunGraphCall[], step: number): ReplayFrame {
  const hidden = new Set<string>();
  const active = new Set<string>();
  if (step >= calls.length) return { hidden, active };
  for (let i = calls.length - 1; i > step; i--) for (const n of calls[i].nodes) hidden.add(n.ref_id);
  for (let i = 0; i <= step && i < calls.length; i++) for (const n of calls[i].nodes) hidden.delete(n.ref_id);
  if (step >= 0) for (const n of calls[step].nodes) active.add(n.ref_id);
  return { hidden, active };
}
