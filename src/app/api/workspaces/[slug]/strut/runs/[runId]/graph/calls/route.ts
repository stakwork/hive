/**
 * GET /api/workspaces/:slug/strut/runs/:runId/graph/calls?under=<call path>
 *     — the calls of a run the trace's run launched (`meta/run-workflow`, or
 *     `strut/run-workflow` on a peer workspace), loaded when the viewer opens
 *     the call that launched it. `under` is that call's path in the trace;
 *     the run is found from the logs, never named by the request.
 *
 * Access: as for the trace, any member of the run's workspace; a child that
 * ran on a peer workspace, a member of that one too (403 otherwise).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireMemberAccess, resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { logger } from "@/lib/logger";
import { findStrutRunRow } from "@/services/strut-runs";
import { readStrutRunGraphChild } from "@/services/strut-runs/run-graph";
import { peerAccessFor } from "@/services/strut-runs/run-graph-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A call path is the run's own event path, never this long. */
const MAX_UNDER_CHARS = 2000;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; runId: string }> }) {
  try {
    const { slug, runId } = await params;
    const member = requireMemberAccess(await resolveWorkspaceAccess(request, { slug }));
    if (member instanceof NextResponse) return member;
    const under = request.nextUrl.searchParams.get("under") ?? "";
    if (!under || under.length > MAX_UNDER_CHARS) {
      return NextResponse.json({ error: "Name the call to open as `under`" }, { status: 400 });
    }

    const row = await findStrutRunRow(member.workspaceId, runId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const read = await readStrutRunGraphChild(row, under, peerAccessFor(request));
    if ("calls" in read) return NextResponse.json({ calls: read.calls });
    if ("denied" in read) return NextResponse.json({ error: `Not readable here: ${read.denied}` }, { status: 403 });
    if ("notFound" in read) return NextResponse.json({ error: "No run was launched there" }, { status: 404 });
    return NextResponse.json({ error: "Could not read the run from strut" }, { status: 502 });
  } catch (error) {
    logger.error("Could not answer a strut run's child calls", "STRUT_RUN_GRAPH", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
