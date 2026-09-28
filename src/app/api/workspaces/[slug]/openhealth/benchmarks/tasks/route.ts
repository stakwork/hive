/**
 * GET /api/workspaces/:slug/openhealth/benchmarks/tasks?split=public|heldout
 *     — the benchmark tasks of a split, from the workspace strut's
 *     `openhealth-list-tasks` workflow (cached). Default `public`.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { isOpenHealthSplit, OPENHEALTH_DEFAULT_SPLIT } from "@/lib/openhealth-benchmarks/constants";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOpenHealthTasks } from "@/services/openhealth-benchmarks/tasks";
import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    const split = request.nextUrl.searchParams.get("split") ?? OPENHEALTH_DEFAULT_SPLIT;
    if (!isOpenHealthSplit(split)) {
      return NextResponse.json({ error: 'split must be "public" or "heldout"' }, { status: 400 });
    }

    const rate = await checkRateLimit(`openhealth:tasks:${member.userId}`, 60, 60);
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

    const list = await getOpenHealthTasks(resolved.target, split);
    if (!list) return NextResponse.json({ error: "Could not load the task list from strut" }, { status: 502 });
    return NextResponse.json(list);
  } catch (error) {
    console.error("[OpenHealth] tasks GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
