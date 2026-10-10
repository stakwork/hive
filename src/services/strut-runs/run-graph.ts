/**
 * A strut run's graph trace: every call that touched the knowledge graph,
 * in order, and the nodes and edges those calls touched — the projection
 * (`lib/strut-run-graph`) hydrated from the run's own swarm. The raw events
 * stay here: a step's payload can hold an answer key.
 *
 * A run that called a workflow on ANOTHER workspace's strut (`strut/run-workflow`
 * — a job's `explore` on `@slug`) carries that run's nodes too, tagged with
 * the peer's slug. They are read from that workspace's swarm, and only for a
 * viewer who is a member of it, in the same org as the run's workspace:
 * being able to read a run here is not being able to read another
 * workspace's graph. Otherwise they stay as the log named them.
 */

import { db } from "@/lib/db";
import {
  hydrateRunGraphAcross,
  readRunGraphNode,
  swarmCypherRunner,
  type PeerGraph,
  type RunGraphNodeRead,
} from "@/lib/strut-run-graph/hydrate";
import { parseQualifiedRef } from "@/lib/strut-run-graph/peer-ref";
import { distinctNodeRefs, projectRunGraphCalls } from "@/lib/strut-run-graph/project";
import type { RunGraphTrace } from "@/lib/strut-run-graph/types";
import { labForRow, type StrutRunRow } from "@/services/strut-runs";
import { fetchStrutRunEvents } from "@/services/strut-runs/lab";

type GraphRow = Pick<StrutRunRow, "id" | "workspaceId" | "swarmId" | "workflow" | "strutRunId">;

/**
 * Whether the viewer may read workspace `slug` — the route's call, from the
 * request: the workspace's id when they are a member, else why not.
 */
export type PeerAccess = (slug: string) => Promise<{ workspaceId: string } | { reason: string }>;

/** No viewer to check: no peer's graph is read. */
const NO_PEERS: PeerAccess = async (slug) => ({ reason: `not read for @${slug}` });

/** Peer workspace `slug`'s graph, when the viewer may read it and it is in the run's org; else why not. */
async function peerGraphFor(row: Pick<GraphRow, "workspaceId">, slug: string, access: PeerAccess): Promise<PeerGraph> {
  const allowed = await access(slug);
  if ("reason" in allowed) return allowed;
  const workspaces = await db.workspace.findMany({
    where: { id: { in: [row.workspaceId, allowed.workspaceId] }, deleted: false },
    select: { id: true, sourceControlOrgId: true, swarm: { select: { id: true } } },
  });
  const home = workspaces.find((w) => w.id === row.workspaceId);
  const peer = workspaces.find((w) => w.id === allowed.workspaceId);
  if (!home?.sourceControlOrgId || peer?.sourceControlOrgId !== home.sourceControlOrgId) {
    return { reason: `@${slug} is not a workspace of this org` };
  }
  if (!peer.swarm) return { reason: `@${slug} has no swarm` };
  const lab = await labForRow({ swarmId: peer.swarm.id });
  if (!lab) return { reason: `@${slug}'s swarm could not be reached` };
  return { run: swarmCypherRunner({ name: lab.swarmName, apiKey: lab.swarmApiKey }) };
}

/** The run's trace; null when the lab or the swarm could not be read. */
export async function readStrutRunGraph(row: GraphRow, access: PeerAccess = NO_PEERS): Promise<RunGraphTrace | null> {
  const [events, lab] = await Promise.all([fetchStrutRunEvents(row), labForRow(row)]);
  if (!events || !lab) return null;
  const calls = projectRunGraphCalls(events);
  const graph = await hydrateRunGraphAcross(
    distinctNodeRefs(calls),
    swarmCypherRunner({ name: lab.swarmName, apiKey: lab.swarmApiKey }),
    (slug) => peerGraphFor(row, slug, access),
  );
  return { calls, ...graph };
}

/** What a run did in the graph, as a card counts it. */
export interface StrutRunGraphCounts {
  /** Its calls that touched the graph, searches included. */
  calls: number;
  /** The distinct nodes those calls read or wrote — never a search's hits; a peer's graph's included. */
  nodes: number;
}

/**
 * The counts of a settled run's trace, from its log alone — nothing is read
 * from the graph. Null when the run touched the graph not at all, or its log
 * could not be read within `timeoutMs`.
 */
export async function countStrutRunGraph(
  row: Omit<GraphRow, "workspaceId">,
  timeoutMs?: number,
): Promise<StrutRunGraphCounts | null> {
  const events = await fetchStrutRunEvents(row, timeoutMs);
  if (!events) return null;
  const calls = projectRunGraphCalls(events);
  return calls.length > 0 ? { calls: calls.length, nodes: distinctNodeRefs(calls).length } : null;
}

/**
 * One node of a graph the run used, whole — the run's own, or a peer's by
 * its qualified id (`@slug:<ref_id>`), checked like the trace checks it. Null
 * when the run's swarm could not be read; `{ found: false, denied }` when the
 * viewer may not read that peer's graph.
 */
export async function readStrutRunGraphNode(
  row: Pick<StrutRunRow, "workspaceId" | "swarmId">,
  id: string,
  access: PeerAccess = NO_PEERS,
): Promise<RunGraphNodeRead | null> {
  const { peer, refId } = parseQualifiedRef(id);
  if (peer) {
    const graph = await peerGraphFor(row, peer, access);
    return "reason" in graph ? { found: false, denied: graph.reason } : readRunGraphNode(refId, graph.run);
  }
  const lab = await labForRow(row);
  if (!lab) return null;
  return readRunGraphNode(refId, swarmCypherRunner({ name: lab.swarmName, apiKey: lab.swarmApiKey }));
}
