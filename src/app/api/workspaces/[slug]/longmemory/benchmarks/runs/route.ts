/**
 * GET /api/workspaces/:slug/longmemory/benchmarks/runs — the workspace's
 * LongMemory runs (single and batch), newest first, `{ runs, total }`, each
 * `result` a `LongMemoryRunResult` JSON string.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark } from "@/lib/benchmarks/access";
import { LONGMEMORY_BENCHMARK_SLUG, listLongMemoryRuns } from "@/services/strut-runs/longmemory-benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const auth = await authorizeBenchmark(request, slug, LONGMEMORY_BENCHMARK_SLUG);
    if (auth instanceof NextResponse) return auth;
    return NextResponse.json(await listLongMemoryRuns(auth.member.workspaceId));
  } catch (error) {
    console.error("[longmemory/benchmarks/runs] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
