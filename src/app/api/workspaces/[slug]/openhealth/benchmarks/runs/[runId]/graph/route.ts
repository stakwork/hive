/**
 * GET /api/workspaces/:slug/openhealth/benchmarks/runs/:runId/graph
 *     — the run's graph trace: every call that touched the knowledge graph,
 *     in order, and the nodes and edges those calls touched.
 *
 * The run's raw events stay on the server: a step's payload can hold the
 * answer key. Only the projection (`lib/strut-run-graph`) is returned.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { hydrateRunGraph, swarmCypherRunner } from "@/lib/strut-run-graph/hydrate";
import { distinctNodeRefs, projectRunGraphCalls } from "@/lib/strut-run-graph/project";
import type { RunGraphTrace } from "@/lib/strut-run-graph/types";
import { labForRow } from "@/services/strut-runs";
import { fetchStrutRunEvents } from "@/services/strut-runs/lab";
import { findOpenHealthRunRow } from "@/services/strut-runs/openhealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; runId: string }> },
) {
  try {
    const { slug, runId } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    const row = await findOpenHealthRunRow(member.workspaceId, runId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [events, lab] = await Promise.all([fetchStrutRunEvents(row), labForRow(row)]);
    if (!events || !lab) {
      return NextResponse.json({ error: "Could not read the run from strut" }, { status: 502 });
    }

    const calls = projectRunGraphCalls(events);
    const graph = await hydrateRunGraph(
      distinctNodeRefs(calls),
      swarmCypherRunner({ name: lab.swarmName, apiKey: lab.swarmApiKey }),
    );
    const body: RunGraphTrace = { calls, ...graph };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[OpenHealth] run graph error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
