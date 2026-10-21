/**
 * GET /api/workspaces/:slug/legal/benchmarks/strut/runs — the workspace's
 * `harvey-lab-run` runs, newest first, as `/api/stakwork/runs` lists rows
 * (`{ runs, total }`, each `result` a `BenchmarkRunResult` JSON string), so
 * the Legal Benchmarks page reads them with the parsing it already has.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark } from "@/lib/benchmarks/access";
import { HARVEY_LAB_BENCHMARK_SLUG, listLegalStrutRuns } from "@/services/strut-runs/legal-benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const auth = await authorizeBenchmark(request, slug, HARVEY_LAB_BENCHMARK_SLUG);
    if (auth instanceof NextResponse) return auth;
    return NextResponse.json(await listLegalStrutRuns(auth.member.workspaceId));
  } catch (error) {
    console.error("[legal/benchmarks/strut/runs] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
