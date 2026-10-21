/**
 * GET /api/workspaces/:slug/legal/benchmarks/strut/cascade/session?runId=&sessionId=
 *     — one agent of a `harvey-lab-run` run with its sub-agents (flat, each
 *     naming its parent), `{ success, data: { ...session, descendants } }`.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveStrutTraceRow, strutTraceSessionDetail } from "@/services/strut-runs/legal-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const row = await resolveStrutTraceRow(request, (await params).slug);
    if (row instanceof NextResponse) return row;
    const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim();
    if (!sessionId) return NextResponse.json({ error: "sessionId query param is required" }, { status: 400 });
    const detail = await strutTraceSessionDetail(row, sessionId);
    if (!detail) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ success: true, data: detail });
  } catch (error) {
    console.error("[legal/benchmarks/strut/cascade/session] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
