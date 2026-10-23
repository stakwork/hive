/**
 * GET /api/workspaces/:slug/legal/benchmarks/strut/cascade/sessions?runId=
 *     — a `harvey-lab-run` run's top-level agents in the legal cascade's
 *     session shape, `{ success, data: { sessions } }` (the strut twin of
 *     `legal/benchmarks/cascade/sessions`, read from the run's strut log).
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveStrutTraceRow, strutTraceSessions } from "@/services/strut-runs/legal-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const row = await resolveStrutTraceRow(request, (await params).slug);
    if (row instanceof NextResponse) return row;
    const sessions = await strutTraceSessions(row);
    if (!sessions) return NextResponse.json({ error: "Could not read the run from strut" }, { status: 502 });
    return NextResponse.json({ success: true, data: { sessions } });
  } catch (error) {
    console.error("[legal/benchmarks/strut/cascade/sessions] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
