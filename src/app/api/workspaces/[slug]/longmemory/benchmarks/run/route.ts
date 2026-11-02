/**
 * POST /api/workspaces/:slug/longmemory/benchmarks/run
 *      { questionId }            → `longmemory-run` for one question
 *      { all: true, limit? }     → `longmemory-batch` over all questions (or the first `limit`)
 *
 * On the workspace's strut. DEVELOPER and up; one run in flight per question
 * (one batch at a time). 202 `{ run_id }`.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark, checkRateLimitSafe } from "@/lib/benchmarks/access";
import { getBaseUrl } from "@/lib/utils";
import { StrutDispatchError } from "@/services/strut-runs";
import {
  LONGMEMORY_BENCHMARK_SLUG,
  LongMemoryRunInProgressError,
  launchLongMemoryBatch,
  launchLongMemoryRun,
} from "@/services/strut-runs/longmemory-benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUN_RATE_LIMIT = 20;
const RUN_WINDOW_SECS = 60 * 60;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { slug } = await params;
    const auth = await authorizeBenchmark(request, slug, LONGMEMORY_BENCHMARK_SLUG, { launch: true });
    if (auth instanceof NextResponse) return auth;
    const { member } = auth;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const all = body?.all === true;
    const questionId = typeof body?.questionId === "string" ? body.questionId.trim() : "";
    if (!all && !questionId) return NextResponse.json({ error: "questionId or all is required" }, { status: 400 });
    let limit: number | undefined;
    if (all && body?.limit !== undefined && body.limit !== null && body.limit !== "") {
      if (typeof body.limit !== "number" || !Number.isInteger(body.limit) || body.limit < 1) {
        return NextResponse.json({ error: "limit must be a positive integer" }, { status: 400 });
      }
      limit = body.limit;
    }

    const rate = await checkRateLimitSafe(`longmemory:run:${member.workspaceId}`, RUN_RATE_LIMIT, RUN_WINDOW_SECS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many benchmark runs. Try again later." },
        { status: 429, headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined },
      );
    }

    const common = {
      workspaceId: member.workspaceId,
      userId: member.userId,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
    };
    const dispatched = all
      ? await launchLongMemoryBatch({ ...common, limit })
      : await launchLongMemoryRun({ ...common, questionId });
    return NextResponse.json({ success: true, run_id: dispatched.runId }, { status: 202 });
  } catch (error) {
    if (error instanceof LongMemoryRunInProgressError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof StrutDispatchError) {
      const status = error.code === "no_target" || error.code === "unreachable" ? 503 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[longmemory/benchmarks/run] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
