/** GET /api/workspaces/:slug/longmemory/benchmarks/runs/:runId — one run, `{ run }`. */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark } from "@/lib/benchmarks/access";
import { LONGMEMORY_BENCHMARK_SLUG, getLongMemoryRun } from "@/services/strut-runs/longmemory-benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; runId: string }> },
) {
  try {
    const { slug, runId } = await params;
    const auth = await authorizeBenchmark(request, slug, LONGMEMORY_BENCHMARK_SLUG);
    if (auth instanceof NextResponse) return auth;
    const run = await getLongMemoryRun(auth.member.workspaceId, runId);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (error) {
    console.error("[longmemory/benchmarks/runs/:runId] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
