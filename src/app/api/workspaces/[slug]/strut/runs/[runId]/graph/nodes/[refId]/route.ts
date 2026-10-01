/**
 * GET /api/workspaces/:slug/strut/runs/:runId/graph/nodes/:refId
 *     — one node the run touched, whole: its labels and every property but
 *     the vectors, read from the graph the run used. The trace names a node;
 *     this is for reading it — a Concept's docs, a Document's text.
 *
 * Access: as for the trace, any member of the run's workspace.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { logger } from "@/lib/logger";
import { isRunGraphRefId } from "@/lib/strut-run-graph/hydrate";
import { findStrutRunRow } from "@/services/strut-runs";
import { readStrutRunGraphNode } from "@/services/strut-runs/run-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; runId: string; refId: string }> },
) {
  try {
    const { slug, runId, refId } = await params;
    const member = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
    if (member instanceof NextResponse) return member;
    if (!isRunGraphRefId(refId)) return NextResponse.json({ error: "Not a node id" }, { status: 400 });

    const row = await findStrutRunRow(member.workspaceId, runId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const read = await readStrutRunGraphNode(row, refId);
    if (!read) return NextResponse.json({ error: "Could not reach the run's swarm" }, { status: 502 });
    if (!read.found) {
      return read.unread
        ? NextResponse.json({ error: `The graph did not answer (${read.unread})` }, { status: 502 })
        : NextResponse.json({ error: "The graph no longer holds this node" }, { status: 404 });
    }
    return NextResponse.json(read.node);
  } catch (error) {
    logger.error("Could not answer a strut run's graph node", "STRUT_RUN_GRAPH", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
