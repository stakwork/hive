/**
 * GET /api/workspaces/:slug/legal/benchmarks/strut/cascade/turns?runId=&sessionId=&after=
 *     — one agent's turns of a `harvey-lab-run` run, `{ success, data: page }`
 *     in the cascade's turns-page shape. A finished agent's chain comes whole,
 *     with its reasoning from the transcript.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveStrutTraceRow, strutTraceTurns } from "@/services/strut-runs/legal-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const row = await resolveStrutTraceRow(request, (await params).slug);
    if (row instanceof NextResponse) return row;
    const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
    if (!sessionId) return NextResponse.json({ error: "sessionId query param is required" }, { status: 400 });
    const afterRaw = request.nextUrl.searchParams.get("after");
    const after = afterRaw === null ? -1 : parseInt(afterRaw, 10);
    if (Number.isNaN(after) || after < -1) {
      return NextResponse.json({ error: "after must be an integer >= -1" }, { status: 400 });
    }
    const page = await strutTraceTurns(row, sessionId, after);
    if (!page) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: page });
  } catch (error) {
    console.error("[legal/benchmarks/strut/cascade/turns] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
