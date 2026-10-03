/**
 * GET  /api/workspaces/:slug/openhealth/benchmarks/climbs
 *      — the workspace's climbs, newest first. One in flight carries the
 *      iterations its event log has seen so far.
 * POST /api/workspaces/:slug/openhealth/benchmarks/climbs
 *      { gtId, split?, task?, variant?, targetF1?, maxRuns? }
 *      — launch `openhealth-improve-loop` on a task from the catalogue of
 *      that benchmark (`task` + `variant`, diagnosis when unnamed):
 *      run → improve → run … until a run scores `targetF1` or `maxRuns`
 *      runs are done. One run or climb in flight per task; DEVELOPER and up.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import {
  isClimbRuns,
  isClimbTarget,
  OPENHEALTH_CLIMB_DEFAULT_RUNS,
  OPENHEALTH_CLIMB_DEFAULT_TARGET,
  OPENHEALTH_CLIMB_MAX_RUNS,
} from "@/lib/openhealth-benchmarks/climb";
import {
  isOpenHealthSplit,
  OPENHEALTH_DEFAULT_SPLIT,
  openHealthBenchmarkFrom,
} from "@/lib/openhealth-benchmarks/constants";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/utils";
import { getOpenHealthTasks } from "@/services/openhealth-benchmarks/tasks";
import { StrutDispatchError } from "@/services/strut-runs";
import {
  hasPendingOpenHealthClimb,
  hasPendingOpenHealthRun,
  launchOpenHealthClimb,
  listOpenHealthClimbs,
} from "@/services/strut-runs/openhealth";
import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";
import type { OpenHealthClimbsResponse } from "@/types/openhealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A climb is up to ten benchmark runs and the improve runs between them. */
const CLIMB_RATE_LIMIT = 10;
const CLIMB_WINDOW_SECS = 60 * 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    const body: OpenHealthClimbsResponse = { climbs: await listOpenHealthClimbs(member.workspaceId) };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[OpenHealth] climbs GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const member = await authorizeOpenHealth(request, slug, { launch: true });
    if (member instanceof NextResponse) return member;

    const payload = (await request.json().catch(() => ({}))) as {
      gtId?: unknown;
      split?: unknown;
      task?: unknown;
      variant?: unknown;
      targetF1?: unknown;
      maxRuns?: unknown;
    };
    const gtId = payload.gtId;
    if (typeof gtId !== "number" || !Number.isInteger(gtId) || gtId <= 0) {
      return NextResponse.json({ error: "gtId must be a task id" }, { status: 400 });
    }
    const split = payload.split ?? OPENHEALTH_DEFAULT_SPLIT;
    if (!isOpenHealthSplit(split)) {
      return NextResponse.json({ error: 'split must be "public" or "heldout"' }, { status: 400 });
    }
    const benchmark = openHealthBenchmarkFrom(payload.task, payload.variant);
    if (!benchmark) {
      return NextResponse.json({ error: "task or variant is not one the page offers" }, { status: 400 });
    }
    const targetF1 = payload.targetF1 ?? OPENHEALTH_CLIMB_DEFAULT_TARGET;
    if (!isClimbTarget(targetF1)) {
      return NextResponse.json({ error: "targetF1 must be a score above 0 and at most 1" }, { status: 400 });
    }
    const maxRuns = payload.maxRuns ?? OPENHEALTH_CLIMB_DEFAULT_RUNS;
    if (!isClimbRuns(maxRuns)) {
      return NextResponse.json(
        { error: `maxRuns must be a whole number from 1 to ${OPENHEALTH_CLIMB_MAX_RUNS}` },
        { status: 400 },
      );
    }

    const rate = await checkRateLimit(`openhealth:climb:${member.workspaceId}`, CLIMB_RATE_LIMIT, CLIMB_WINDOW_SECS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many climbs. Try again later." },
        { status: 429, headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined },
      );
    }

    // Only a task the catalogue lists is launched: strut does not check the
    // id up front, and an unknown one would cost a run that ends in an error.
    const resolved = await resolveStrutTarget({
      purpose: "benchmark",
      userId: member.userId,
      workspaceId: member.workspaceId,
    });
    if (!resolved.ok) {
      return NextResponse.json({ error: describeStrutTargetError(resolved.error) }, { status: 503 });
    }
    const catalogue = await getOpenHealthTasks(resolved.target, split, benchmark);
    if (!catalogue) {
      return NextResponse.json({ error: "Could not load the task list from strut" }, { status: 502 });
    }
    if (!catalogue.tasks.some((task) => task.gtId === gtId)) {
      return NextResponse.json({ error: `No task ${gtId} in the ${split} split` }, { status: 400 });
    }

    // A climb and a run on the same task would improve the same Concepts at once.
    if (await hasPendingOpenHealthClimb(member.workspaceId, gtId)) {
      return NextResponse.json({ error: "A climb of this task is already in progress" }, { status: 409 });
    }
    if (await hasPendingOpenHealthRun(member.workspaceId, gtId)) {
      return NextResponse.json({ error: "A run of this task is already in progress" }, { status: 409 });
    }

    const dispatched = await launchOpenHealthClimb({
      workspaceId: member.workspaceId,
      userId: member.userId,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
      gtId,
      task: benchmark.task,
      targetF1,
      maxRuns,
    });
    return NextResponse.json(
      { success: true, climbId: dispatched.runId, strutRunId: dispatched.strutRunId },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof StrutDispatchError) {
      const status = error.code === "no_target" || error.code === "unreachable" ? 503 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[OpenHealth] climbs POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
