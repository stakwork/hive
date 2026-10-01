/**
 * POST /api/workspaces/:slug/openhealth/benchmarks/climbs/:climbId/cancel
 *      — ask strut to stop a climb in flight. Cooperative: the loop ends at
 *      its next step and settles as cancelled; the Concepts its improve runs
 *      wrote stay. DEVELOPER and up.
 */

import { NextRequest, NextResponse } from "next/server";
import { StrutRunStatus } from "@prisma/client";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { cancelStrutRun } from "@/services/strut-runs";
import { findOpenHealthClimbRow } from "@/services/strut-runs/openhealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string; climbId: string }> }) {
  try {
    const { slug, climbId } = await params;
    const member = await authorizeOpenHealth(request, slug, { launch: true });
    if (member instanceof NextResponse) return member;

    const row = await findOpenHealthClimbRow(member.workspaceId, climbId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.status !== StrutRunStatus.PENDING) {
      return NextResponse.json({ error: "The climb is not in progress" }, { status: 409 });
    }
    if (!(await cancelStrutRun(row))) {
      return NextResponse.json({ error: "Strut did not acknowledge the cancel" }, { status: 502 });
    }
    return NextResponse.json({ success: true }, { status: 202 });
  } catch (error) {
    console.error("[OpenHealth] climb cancel error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
