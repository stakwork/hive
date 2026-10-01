/**
 * POST /api/workspaces/:slug/openhealth/benchmarks/climbs/:climbId/stop
 *      — end a running climb and ask strut to cancel its step in flight
 *      (cooperative: that step settles as cancelled). DEVELOPER and up.
 */

import { NextRequest, NextResponse } from "next/server";
import { OpenHealthClimbStatus } from "@prisma/client";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { findOpenHealthClimbRow, stopOpenHealthClimb } from "@/services/strut-runs/openhealth-climb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string; climbId: string }> }) {
  try {
    const { slug, climbId } = await params;
    const member = await authorizeOpenHealth(request, slug, { launch: true });
    if (member instanceof NextResponse) return member;

    const climb = await findOpenHealthClimbRow(member.workspaceId, climbId);
    if (!climb) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (climb.status !== OpenHealthClimbStatus.RUNNING) {
      return NextResponse.json({ error: "The climb is not running" }, { status: 409 });
    }
    if (!(await stopOpenHealthClimb(climb, "Stopped by a member."))) {
      return NextResponse.json({ error: "The climb is not running" }, { status: 409 });
    }
    return NextResponse.json({ success: true }, { status: 202 });
  } catch (error) {
    console.error("[OpenHealth] climb stop error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
