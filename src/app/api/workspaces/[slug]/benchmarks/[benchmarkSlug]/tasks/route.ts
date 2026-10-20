/**
 * GET /api/workspaces/:slug/benchmarks/:benchmarkSlug/tasks[?params=<json>]
 *     — the benchmark's tasks from its `listWorkflow` ([{ id, title, ... }]);
 *     an empty list when it has none. `params` is the list workflow's input.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark, checkRateLimitSafe } from "@/lib/benchmarks/access";
import { getBenchmarkTasks } from "@/services/benchmarks/tasks";
import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; benchmarkSlug: string }> },
) {
  try {
    const { slug, benchmarkSlug } = await params;
    const auth = await authorizeBenchmark(request, slug, benchmarkSlug);
    if (auth instanceof NextResponse) return auth;
    const { member, benchmark } = auth;
    if (!benchmark.listWorkflow) return NextResponse.json({ tasks: [] });

    let input: Record<string, unknown> = { ...(benchmark.input?.listInput ?? {}) };
    const raw = request.nextUrl.searchParams.get("params");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
        input = { ...input, ...parsed };
      } catch {
        return NextResponse.json({ error: "params must be a JSON object" }, { status: 400 });
      }
    }

    const rate = await checkRateLimitSafe(`benchmark:tasks:${member.userId}`, 60, 60);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Too many requests", retryAfter: rate.retryAfter }, { status: 429 });
    }

    const resolved = await resolveStrutTarget({
      purpose: "benchmark",
      userId: member.userId,
      workspaceId: member.workspaceId,
    });
    if (!resolved.ok) {
      return NextResponse.json({ error: describeStrutTargetError(resolved.error) }, { status: 503 });
    }
    try {
      return NextResponse.json({ tasks: await getBenchmarkTasks(resolved.target, benchmark, input) });
    } catch {
      return NextResponse.json({ error: "Could not load the task list from strut" }, { status: 502 });
    }
  } catch (error) {
    console.error("[Benchmarks] tasks GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
