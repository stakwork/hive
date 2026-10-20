/** GET /api/workspaces/:slug/benchmarks/:benchmarkSlug/runs/:runId — one run, with its headline and filtered extra JSON. */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark } from "@/lib/benchmarks/access";
import { getBenchmarkRun } from "@/services/strut-runs/benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; benchmarkSlug: string; runId: string }> },
) {
  try {
    const { slug, benchmarkSlug, runId } = await params;
    const auth = await authorizeBenchmark(request, slug, benchmarkSlug);
    if (auth instanceof NextResponse) return auth;
    const run = await getBenchmarkRun(auth.member.workspaceId, auth.benchmark, runId);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (error) {
    console.error("[Benchmarks] run GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
