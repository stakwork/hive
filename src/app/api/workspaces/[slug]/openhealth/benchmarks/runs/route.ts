/**
 * GET  /api/workspaces/:slug/openhealth/benchmarks/runs
 *      — the workspace's benchmark runs, newest first (PENDING ones settled
 *      from strut when the run is over there and the callback never arrived).
 * POST /api/workspaces/:slug/openhealth/benchmarks/runs  { gtId, split? }
 *      — launch one `openhealth-run` for a task from the catalogue. One run
 *      in flight per task; DEVELOPER and up.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import { isOpenHealthSplit, OPENHEALTH_DEFAULT_SPLIT } from "@/lib/openhealth-benchmarks/constants";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/utils";
import { getOpenHealthTasks } from "@/services/openhealth-benchmarks/tasks";
import { StrutDispatchError } from "@/services/strut-runs";
import { hasPendingOpenHealthRun, launchOpenHealthRun, listOpenHealthRuns } from "@/services/strut-runs/openhealth";
import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";
import type { OpenHealthRunsResponse } from "@/types/openhealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A run costs a few dollars of LLM usage. */
const RUN_RATE_LIMIT = 20;
const RUN_WINDOW_SECS = 60 * 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    const body: OpenHealthRunsResponse = { runs: await listOpenHealthRuns(member.workspaceId) };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[OpenHealth] runs GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const member = await authorizeOpenHealth(request, slug, { launch: true });
    if (member instanceof NextResponse) return member;

    const payload = (await request.json().catch(() => ({}))) as { gtId?: unknown; split?: unknown };
    const gtId = payload.gtId;
    if (typeof gtId !== "number" || !Number.isInteger(gtId) || gtId <= 0) {
      return NextResponse.json({ error: "gtId must be a task id" }, { status: 400 });
    }
    const split = payload.split ?? OPENHEALTH_DEFAULT_SPLIT;
    if (!isOpenHealthSplit(split)) {
      return NextResponse.json({ error: 'split must be "public" or "heldout"' }, { status: 400 });
    }

    const rate = await checkRateLimit(`openhealth:run:${member.workspaceId}`, RUN_RATE_LIMIT, RUN_WINDOW_SECS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many benchmark runs. Try again later." },
        { status: 429, headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined },
      );
    }

    // Strut does not check the id up front: an unknown one costs a run that
    // ends in an error. Only a task the catalogue lists is launched.
    const resolved = await resolveStrutTarget({
      purpose: "benchmark",
      userId: member.userId,
      workspaceId: member.workspaceId,
    });
    if (!resolved.ok) {
      return NextResponse.json({ error: describeStrutTargetError(resolved.error) }, { status: 503 });
    }
    const catalogue = await getOpenHealthTasks(resolved.target, split);
    if (!catalogue) {
      return NextResponse.json({ error: "Could not load the task list from strut" }, { status: 502 });
    }
    if (!catalogue.tasks.some((task) => task.gtId === gtId)) {
      return NextResponse.json({ error: `No task ${gtId} in the ${split} split` }, { status: 400 });
    }

    if (await hasPendingOpenHealthRun(member.workspaceId, gtId)) {
      return NextResponse.json({ error: "A run of this task is already in progress" }, { status: 409 });
    }

    const dispatched = await launchOpenHealthRun({
      workspaceId: member.workspaceId,
      userId: member.userId,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
      gtId,
    });
    return NextResponse.json(
      { success: true, runId: dispatched.runId, strutRunId: dispatched.strutRunId },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof StrutDispatchError) {
      const status = error.code === "no_target" || error.code === "unreachable" ? 503 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[OpenHealth] runs POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
