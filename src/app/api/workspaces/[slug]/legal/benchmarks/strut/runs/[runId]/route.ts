/** GET /api/workspaces/:slug/legal/benchmarks/strut/runs/:runId — one `harvey-lab-run` run, `{ run }` in the runs list's row shape. */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark } from "@/lib/benchmarks/access";
import { HARVEY_LAB_BENCHMARK_SLUG, getLegalStrutRun } from "@/services/strut-runs/legal-benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; runId: string }> },
) {
  try {
    const { slug, runId } = await params;
    const auth = await authorizeBenchmark(request, slug, HARVEY_LAB_BENCHMARK_SLUG);
    if (auth instanceof NextResponse) return auth;
    const run = await getLegalStrutRun(auth.member.workspaceId, runId);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (error) {
    console.error("[legal/benchmarks/strut/runs/:runId] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
