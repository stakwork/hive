/**
 * GET /api/workspaces/:slug/openhealth/benchmarks/climbs/:climbId/graph
 *     — the loop's graph trace: every call of every iteration that touched
 *     the knowledge graph, in order, and the nodes and edges they touched.
 *     The viewer lays the calls out by iteration.
 *
 * The raw events stay on the server: a step's payload can hold the answer
 * key. Only the projection (`lib/strut-run-graph`) is returned.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { findOpenHealthClimbRow } from "@/services/strut-runs/openhealth";
import { readStrutRunGraph } from "@/services/strut-runs/run-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; climbId: string }> }) {
  try {
    const { slug, climbId } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    const row = await findOpenHealthClimbRow(member.workspaceId, climbId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const trace = await readStrutRunGraph(row);
    if (!trace) return NextResponse.json({ error: "Could not read the climb from strut" }, { status: 502 });
    return NextResponse.json(trace);
  } catch (error) {
    console.error("[OpenHealth] climb graph error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
