/**
 * The hops a run took through the graph, and the links the viewer draws. Pure.
 *
 * A call that names one node (`ref_id`) and touched others walked from that
 * node to each of them — a neighbours read. A hop is read from the run's own
 * calls, so it is known even when the graph cannot answer for its edges.
 */

import type { RunGraphCall, RunGraphEdge } from "./types";

export interface RunGraphHop {
  source: string;
  target: string;
  /** Index of the call that took the hop. */
  call: number;
}

export function runGraphHops(calls: RunGraphCall[]): RunGraphHop[] {
  const hops: RunGraphHop[] = [];
  calls.forEach((call, index) => {
    const from = call.query.ref_id;
    if (typeof from !== "string" || !call.nodes.some((n) => n.ref_id === from)) return;
    for (const node of call.nodes) {
      if (node.ref_id !== from) hops.push({ source: from, target: node.ref_id, call: index });
    }
  });
  return hops;
}

export interface RunGraphLink {
  source: string;
  target: string;
  /** The graph's edge type; null for a hop the graph gave no edge for. */
  edgeType: string | null;
  /** The hops taken along this link, in call order. */
  hops: RunGraphHop[];
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The graph's edges with the run's hops laid over them. A hop rides the
 * edge between its two nodes, whichever way that edge points; a hop with no
 * edge under it becomes a link of its own.
 */
export function runGraphLinks(edges: RunGraphEdge[], hops: RunGraphHop[]): RunGraphLink[] {
  const links: RunGraphLink[] = [];
  const byPair = new Map<string, RunGraphLink>();
  for (const edge of edges) {
    if (edge.source === edge.target) continue;
    const link: RunGraphLink = { source: edge.source, target: edge.target, edgeType: edge.edge_type, hops: [] };
    links.push(link);
    const key = pairKey(edge.source, edge.target);
    if (!byPair.has(key)) byPair.set(key, link);
  }
  for (const hop of hops) {
    const key = pairKey(hop.source, hop.target);
    let link = byPair.get(key);
    if (!link) {
      link = { source: hop.source, target: hop.target, edgeType: null, hops: [] };
      links.push(link);
      byPair.set(key, link);
    }
    link.hops.push(hop);
  }
  return links;
}

export type RunGraphLinkState = "hidden" | "edge" | "walked" | "current";

/**
 * How a link is drawn at step `step` of a replay (null = the whole run):
 * `current` when the step's own call took a hop along it, `walked` when an
 * earlier call did, `edge` when the run only touched both ends. A hop not
 * taken yet leaves a link with no edge under it `hidden`.
 */
export function linkState(
  link: RunGraphLink,
  step: number | null,
): { state: RunGraphLinkState; hop: RunGraphHop | null } {
  let last: RunGraphHop | null = null;
  for (const hop of link.hops) {
    if (step !== null && hop.call > step) break;
    last = hop;
  }
  if (!last) return { state: link.edgeType === null ? "hidden" : "edge", hop: null };
  return { state: step !== null && last.call === step ? "current" : "walked", hop: last };
}
