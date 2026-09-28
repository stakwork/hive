/**
 * POST /api/workspaces/:slug/openhealth/benchmarks/runs/:runId/cancel
 *      — ask strut to stop a run in flight. Cooperative: the run ends at its
 *      next boundary and settles as cancelled. DEVELOPER and up.
 */

import { NextRequest, NextResponse } from "next/server";
import { StrutRunStatus } from "@prisma/client";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { cancelStrutRun } from "@/services/strut-runs";
import { findOpenHealthRunRow } from "@/services/strut-runs/openhealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; runId: string }> },
) {
  try {
    const { slug, runId } = await params;
    const member = await authorizeOpenHealth(request, slug, { launch: true });
    if (member instanceof NextResponse) return member;

    const row = await findOpenHealthRunRow(member.workspaceId, runId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.status !== StrutRunStatus.PENDING) {
      return NextResponse.json({ error: "The run is not in progress" }, { status: 409 });
    }
    if (!(await cancelStrutRun(row))) {
      return NextResponse.json({ error: "Strut did not acknowledge the cancel" }, { status: 502 });
    }
    return NextResponse.json({ success: true }, { status: 202 });
  } catch (error) {
    console.error("[OpenHealth] run cancel error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
