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
import { findOpenHealthRunRow } from "@/services/strut-runs/openhealth";
import { readStrutRunGraph } from "@/services/strut-runs/run-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; runId: string }> }) {
  try {
    const { slug, runId } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    const row = await findOpenHealthRunRow(member.workspaceId, runId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const trace = await readStrutRunGraph(row);
    if (!trace) return NextResponse.json({ error: "Could not read the run from strut" }, { status: 502 });
    return NextResponse.json(trace);
  } catch (error) {
    console.error("[OpenHealth] run graph error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
