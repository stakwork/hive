/**
 * A strut run's graph trace: every call that touched the knowledge graph,
 * in order, and the nodes and edges those calls touched — the projection
 * (`lib/strut-run-graph`) hydrated from the run's own swarm. The raw events
 * stay here: a step's payload can hold an answer key.
 */

import { hydrateRunGraph, swarmCypherRunner } from "@/lib/strut-run-graph/hydrate";
import { distinctNodeRefs, projectRunGraphCalls } from "@/lib/strut-run-graph/project";
import type { RunGraphTrace } from "@/lib/strut-run-graph/types";
import { labForRow, type StrutRunRow } from "@/services/strut-runs";
import { fetchStrutRunEvents } from "@/services/strut-runs/lab";

type GraphRow = Pick<StrutRunRow, "id" | "swarmId" | "workflow" | "strutRunId">;

/** The run's trace; null when the lab or the swarm could not be read. */
export async function readStrutRunGraph(row: GraphRow): Promise<RunGraphTrace | null> {
  const [events, lab] = await Promise.all([fetchStrutRunEvents(row), labForRow(row)]);
  if (!events || !lab) return null;
  const calls = projectRunGraphCalls(events);
  const graph = await hydrateRunGraph(
    distinctNodeRefs(calls),
    swarmCypherRunner({ name: lab.swarmName, apiKey: lab.swarmApiKey }),
  );
  return { calls, ...graph };
}
