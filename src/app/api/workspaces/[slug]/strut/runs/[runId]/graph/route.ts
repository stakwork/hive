/**
 * GET /api/workspaces/:slug/strut/runs/:runId/graph
 *     — a strut run's graph trace: every call that touched the knowledge
 *     graph, in order, and the nodes and edges those calls touched. A run of
 *     any kind — a benchmark, a climb, a job turn — whatever walked the graph.
 *
 * The run's raw events stay on the server: a step's payload can hold an
 * answer key. Only the projection (`lib/strut-run-graph`) is returned.
 *
 * Access: any member of the run's workspace, as for the Graph Explorer's
 * read-only queries of the same graph.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { logger } from "@/lib/logger";
import { findStrutRunRow } from "@/services/strut-runs";
import { readStrutRunGraph } from "@/services/strut-runs/run-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; runId: string }> }) {
  try {
    const { slug, runId } = await params;
    const member = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
    if (member instanceof NextResponse) return member;

    const row = await findStrutRunRow(member.workspaceId, runId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const trace = await readStrutRunGraph(row);
    if (!trace) return NextResponse.json({ error: "Could not read the run from strut" }, { status: 502 });
    return NextResponse.json(trace);
  } catch (error) {
    logger.error("Could not answer a strut run's graph trace", "STRUT_RUN_GRAPH", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
