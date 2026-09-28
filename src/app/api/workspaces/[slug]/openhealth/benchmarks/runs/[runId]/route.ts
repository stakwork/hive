/**
 * GET /api/workspaces/:slug/openhealth/benchmarks/runs/:runId
 *     — one benchmark run with everything its viewer shows.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { getOpenHealthRun } from "@/services/strut-runs/openhealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; runId: string }> },
) {
  try {
    const { slug, runId } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    const run = await getOpenHealthRun(member.workspaceId, runId);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (error) {
    console.error("[OpenHealth] run GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
