/**
 * GET  /api/workspaces/:slug/benchmarks/:benchmarkSlug/runs — runs, newest first.
 * POST /api/workspaces/:slug/benchmarks/:benchmarkSlug/runs  { taskId?, params? }
 *      — launch the benchmark's run workflow with { taskId, ...params }. DEVELOPER and up.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark, checkRateLimitSafe } from "@/lib/benchmarks/access";
import { getBaseUrl } from "@/lib/utils";
import { getBenchmarkTasks } from "@/services/benchmarks/tasks";
import { StrutDispatchError } from "@/services/strut-runs";
import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";
import type { BenchmarkTask } from "@/types/benchmarks";
import { hasPendingBenchmarkRun, launchBenchmarkRun, listBenchmarkRuns } from "@/services/strut-runs/benchmark";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUN_RATE_LIMIT = 20;
const RUN_WINDOW_SECS = 60 * 60;

type Ctx = { params: Promise<{ slug: string; benchmarkSlug: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { slug, benchmarkSlug } = await params;
    const auth = await authorizeBenchmark(request, slug, benchmarkSlug);
    if (auth instanceof NextResponse) return auth;
    return NextResponse.json({ runs: await listBenchmarkRuns(auth.member.workspaceId, auth.benchmark) });
  } catch (error) {
    console.error("[Benchmarks] runs GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { slug, benchmarkSlug } = await params;
    const auth = await authorizeBenchmark(request, slug, benchmarkSlug, { launch: true });
    if (auth instanceof NextResponse) return auth;
    const { member, benchmark } = auth;

    const payload = (await request.json().catch(() => ({}))) as { taskId?: unknown; params?: unknown };
    const taskId = payload.taskId;
    if (taskId !== undefined && typeof taskId !== "string" && typeof taskId !== "number") {
      return NextResponse.json({ error: "taskId must be a string or number" }, { status: 400 });
    }
    const extra = payload.params;
    if (extra !== undefined && (typeof extra !== "object" || extra === null || Array.isArray(extra))) {
      return NextResponse.json({ error: "params must be a JSON object" }, { status: 400 });
    }
    // No taskId is the free-form fallback (the task list was unavailable): params only.

    const rate = await checkRateLimitSafe(`benchmark:run:${member.workspaceId}`, RUN_RATE_LIMIT, RUN_WINDOW_SECS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many benchmark runs. Try again later." },
        { status: 429, headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined },
      );
    }

    if (taskId !== undefined && (await hasPendingBenchmarkRun(member.workspaceId, benchmark, taskId))) {
      return NextResponse.json({ error: "A run of this task is already in progress" }, { status: 409 });
    }

    // The task comes from the list workflow, never from the client.
    let task: BenchmarkTask | null = null;
    if (benchmark.input?.fromTask && taskId !== undefined) {
      const resolved = await resolveStrutTarget({ purpose: "benchmark", userId: member.userId, workspaceId: member.workspaceId });
      if (!resolved.ok) return NextResponse.json({ error: describeStrutTargetError(resolved.error) }, { status: 503 });
      try {
        const tasks = await getBenchmarkTasks(resolved.target, benchmark, benchmark.input.listInput ?? {});
        task = tasks.find((t) => t.id === taskId) ?? null;
      } catch {
        return NextResponse.json({ error: "Could not load the task list from strut" }, { status: 502 });
      }
      if (!task) return NextResponse.json({ error: `No task ${String(taskId)} in this benchmark` }, { status: 400 });
    }

    const dispatched = await launchBenchmarkRun({
      workspaceId: member.workspaceId,
      userId: member.userId,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
      benchmark,
      taskId,
      task,
      params: extra as Record<string, unknown> | undefined,
    });
    return NextResponse.json({ success: true, runId: dispatched.runId, strutRunId: dispatched.strutRunId }, { status: 202 });
  } catch (error) {
    if (error instanceof StrutDispatchError) {
      const status = error.code === "no_target" || error.code === "unreachable" ? 503 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[Benchmarks] runs POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
