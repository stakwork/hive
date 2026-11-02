/**
 * GET /api/workspaces/:slug/longmemory/benchmarks/tasks — the LongMemory
 * questions (`{ total, tasks: [{ id, type, abstention }] }`), whatever the
 * workspace strut's `longmemory/list-tasks` workflow lists (cached briefly).
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeBenchmark } from "@/lib/benchmarks/access";
import { checkRateLimit } from "@/lib/rate-limit";
import { LONGMEMORY_BENCHMARK_SLUG, getLongMemoryTasks } from "@/services/strut-runs/longmemory-benchmark";
import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const auth = await authorizeBenchmark(request, slug, LONGMEMORY_BENCHMARK_SLUG);
    if (auth instanceof NextResponse) return auth;
    const { member } = auth;

    const rate = await checkRateLimit(`longmemory:tasks:${member.userId}`, 60, 60);
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

    const list = await getLongMemoryTasks(resolved.target);
    if (!list) return NextResponse.json({ error: "Could not load the question list from strut" }, { status: 502 });
    return NextResponse.json(list);
  } catch (error) {
    console.error("[longmemory/benchmarks/tasks] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
