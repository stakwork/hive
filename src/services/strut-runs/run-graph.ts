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
  resolveFileReads,
  swarmCypherRunner,
  type CypherRunner,
  type PeerGraph,
  type RunGraphNodeRead,
} from "@/lib/strut-run-graph/hydrate";
import { parseQualifiedRef, qualifyRef } from "@/lib/strut-run-graph/peer-ref";
import {
  distinctNodeRefs,
  projectRunGraphCalls,
  projectWithLaunches,
  type ProjectOptions,
} from "@/lib/strut-run-graph/project";
import type { RunGraphCall, RunGraphEdge, RunGraphNode, RunGraphTrace } from "@/lib/strut-run-graph/types";
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

/** Peer workspace `slug`'s swarm, when the viewer may read it and it is in the run's org; else why not. */
async function peerSwarmFor(
  row: Pick<GraphRow, "workspaceId">,
  slug: string,
  access: PeerAccess,
): Promise<{ swarmId: string } | { reason: string }> {
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
  return { swarmId: peer.swarm.id };
}

/** Peer workspace `slug`'s graph, by the same rule; else why not. */
async function peerGraphFor(row: Pick<GraphRow, "workspaceId">, slug: string, access: PeerAccess): Promise<PeerGraph> {
  const swarm = await peerSwarmFor(row, slug, access);
  if ("reason" in swarm) return swarm;
  const lab = await labForRow(swarm);
  if (!lab) return { reason: `@${slug}'s swarm could not be reached` };
  return { run: swarmCypherRunner({ name: lab.swarmName, apiKey: lab.swarmApiKey }) };
}

/**
 * The run's calls, each file an agent viewed in a repository the run checked
 * out among them as a read of the graph's `File` node for it — resolved
 * against `run`, the graph the events' strut uses. A file the graph does not
 * hold is no node, so its view is no call; a graph that does not answer
 * leaves the file views out (best effort, like the rest of the trace).
 */
async function callsWithFileReads(
  events: unknown[],
  options: ProjectOptions,
  run: CypherRunner,
): Promise<RunGraphCall[]> {
  const { calls, fileReads } = projectWithLaunches(events, { ...options, fileReads: true });
  if (fileReads.size === 0) return calls;
  const found = await resolveFileReads([...fileReads.values()], run);
  return calls.flatMap((call) => {
    const file = fileReads.get(call.path);
    if (file === undefined) return [call];
    const refId = found instanceof Map ? found.get(file) : undefined;
    if (!refId) return [];
    const ref = qualifyRef(refId, options.peer);
    return [{ ...call, nodes: [{ ref_id: ref, node_type: "File", ...(options.peer ? { peer: options.peer } : {}) }] }];
  });
}

const runnerOf = (lab: { swarmName: string; swarmApiKey: string }): CypherRunner =>
  swarmCypherRunner({ name: lab.swarmName, apiKey: lab.swarmApiKey });

/** The run's trace; null when the lab or the swarm could not be read. */
export async function readStrutRunGraph(row: GraphRow, access: PeerAccess = NO_PEERS): Promise<RunGraphTrace | null> {
  const [events, lab] = await Promise.all([fetchStrutRunEvents(row), labForRow(row)]);
  if (!events || !lab) return null;
  const run = runnerOf(lab);
  const calls = await callsWithFileReads(events, {}, run);
  const graph = await hydrateRunGraphAcross(distinctNodeRefs(calls), run, (slug) => peerGraphFor(row, slug, access));
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

/** How many launches deep a child is followed: a run's child's child's … */
const MAX_CHILD_DEPTH = 8;

export type RunGraphChildRead =
  /**
   * The child run's calls, under the launching call's path, and the nodes
   * they touched resolved — the ones the trace has already (folded onto the
   * launch) and those it cannot have: the files the child read.
   */
  | { calls: RunGraphCall[]; nodes: RunGraphNode[]; edges: RunGraphEdge[] }
  /** No call at that path launched a run — or not one the trace can follow. */
  | { notFound: true }
  /** The viewer may not read the workspace the child ran on. */
  | { denied: string }
  /** A log could not be read. */
  | { unread: true };

/**
 * The calls of the run a launching call started (`meta/run-workflow` here,
 * `strut/run-workflow` on a peer), loaded when the viewer opens that call —
 * `under` is its path in the trace. The run is found from the logs alone,
 * walking down from the row's own run through each launch on the way: a run
 * id is never taken from the request. A child that ran on a peer is read
 * from that workspace's swarm, by the trace's rule (a member, the same org);
 * a peer's own launch on a peer of ITS is not followed (that slug is not one
 * of this org's).
 */
export async function readStrutRunGraphChild(
  row: GraphRow,
  under: string,
  access: PeerAccess = NO_PEERS,
): Promise<RunGraphChildRead> {
  let events = await fetchStrutRunEvents(row);
  let swarmId = row.swarmId;
  let peer: string | undefined;
  let prefix: string | undefined;
  for (let depth = 0; depth < MAX_CHILD_DEPTH; depth++) {
    if (!events) return { unread: true };
    const { launches } = projectWithLaunches(events, { prefix, peer });
    const at = [...launches].find(([path]) => under === path || under.startsWith(`${path}/`));
    if (!at) return { notFound: true };
    const [path, launch] = at;
    if (launch.peer) {
      if (peer) return { notFound: true };
      const swarm = await peerSwarmFor(row, launch.peer, access);
      if ("reason" in swarm) return { denied: swarm.reason };
      swarmId = swarm.swarmId;
      peer = launch.peer;
    }
    events = await fetchStrutRunEvents({ id: row.id, swarmId, workflow: launch.workflow, strutRunId: launch.runId });
    prefix = path;
    if (under === path) {
      const [home, there] = await Promise.all([labForRow(row), labForRow({ swarmId })]);
      if (!events || !home || !there) return { unread: true };
      const calls = await callsWithFileReads(events, { prefix, peer }, runnerOf(there));
      const graph = await hydrateRunGraphAcross(distinctNodeRefs(calls), runnerOf(home), (slug) =>
        peerGraphFor(row, slug, access),
      );
      return { calls, nodes: graph.nodes, edges: graph.edges };
    }
  }
  return { notFound: true };
}
