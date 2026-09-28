/**
 * GET /api/workspaces/:slug/openhealth/benchmarks/runs/:runId/progress
 *     — the stages of a run, read from its strut event log. Polled while
 *     the run is in flight.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { projectOpenHealthStages } from "@/lib/openhealth-benchmarks/stages";
import { fetchStrutRunEvents } from "@/services/strut-runs/lab";
import { findOpenHealthRunRow } from "@/services/strut-runs/openhealth";
import type { OpenHealthProgressResponse } from "@/types/openhealth";

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

    const row = await findOpenHealthRunRow(member.workspaceId, runId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // No events yet (the launch is seconds old, or the lab is away) reads as every stage pending.
    const body: OpenHealthProgressResponse = {
      stages: projectOpenHealthStages(await fetchStrutRunEvents(row)),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[OpenHealth] run progress error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
