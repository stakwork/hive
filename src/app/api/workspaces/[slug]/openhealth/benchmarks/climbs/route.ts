/**
 * GET  /api/workspaces/:slug/openhealth/benchmarks/climbs[?gtId=]
 *      — the workspace's climbs with their steps, newest first.
 * POST /api/workspaces/:slug/openhealth/benchmarks/climbs
 *      { gtId, targetF1?, maxAttempts?, seedRunId? }
 *      — start a climb: benchmark run → improve → run … until a run scores
 *      `targetF1` (default 1), `maxAttempts` runs are spent, an improve run
 *      writes nothing, a step fails, or a member stops it. With `seedRunId`
 *      (a scored run of the task) the climb adopts that run as attempt 1
 *      and starts with an improve over it. One climb per task at a time;
 *      DEVELOPER and up.
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeOpenHealth } from "@/lib/openhealth-benchmarks/access";
import {
  isClimbAttempts,
  isClimbTarget,
  OPENHEALTH_CLIMB_DEFAULT_ATTEMPTS,
  OPENHEALTH_CLIMB_DEFAULT_TARGET,
  OPENHEALTH_CLIMB_MAX_ATTEMPTS,
} from "@/lib/openhealth-benchmarks/climb";
import { isOpenHealthSplit, OPENHEALTH_DEFAULT_SPLIT } from "@/lib/openhealth-benchmarks/constants";
import { checkRateLimit } from "@/lib/rate-limit";
import { getBaseUrl } from "@/lib/utils";
import { getOpenHealthTasks } from "@/services/openhealth-benchmarks/tasks";
import { StrutDispatchError, type StrutRunRow } from "@/services/strut-runs";
import {
  findOpenHealthRunRow,
  hasPendingOpenHealthImprove,
  hasPendingOpenHealthRun,
} from "@/services/strut-runs/openhealth";
import {
  hasRunningOpenHealthClimb,
  listOpenHealthClimbs,
  OpenHealthClimbError,
  startOpenHealthClimb,
} from "@/services/strut-runs/openhealth-climb";
import { describeStrutTargetError, resolveStrutTarget } from "@/services/strut-target";
import type { OpenHealthClimbsResponse } from "@/types/openhealth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A climb is up to ten runs and nine improve runs; its steps are not rate limited, its starts are. */
const CLIMB_RATE_LIMIT = 10;
const CLIMB_WINDOW_SECS = 60 * 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const member = await authorizeOpenHealth(request, slug);
    if (member instanceof NextResponse) return member;

    const raw = request.nextUrl.searchParams.get("gtId");
    const gtId = raw === null ? undefined : Number(raw);
    if (gtId !== undefined && (!Number.isInteger(gtId) || gtId <= 0)) {
      return NextResponse.json({ error: "gtId must be a task id" }, { status: 400 });
    }
    const body: OpenHealthClimbsResponse = { climbs: await listOpenHealthClimbs(member.workspaceId, { gtId }) };
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
      targetF1?: unknown;
      maxAttempts?: unknown;
      seedRunId?: unknown;
    };
    const targetF1 = payload.targetF1 ?? OPENHEALTH_CLIMB_DEFAULT_TARGET;
    if (!isClimbTarget(targetF1)) {
      return NextResponse.json({ error: "targetF1 must be a score above 0 and at most 1" }, { status: 400 });
    }
    const maxAttempts = payload.maxAttempts ?? OPENHEALTH_CLIMB_DEFAULT_ATTEMPTS;
    if (!isClimbAttempts(maxAttempts)) {
      return NextResponse.json(
        { error: `maxAttempts must be a whole number from 1 to ${OPENHEALTH_CLIMB_MAX_ATTEMPTS}` },
        { status: 400 },
      );
    }
    const seedRunId = payload.seedRunId;
    if (seedRunId !== undefined && (typeof seedRunId !== "string" || !seedRunId)) {
      return NextResponse.json({ error: "seedRunId must be a run id" }, { status: 400 });
    }
    // The seed is attempt 1: a climb from it needs at least one more.
    if (seedRunId && maxAttempts < 2) {
      return NextResponse.json({ error: "A climb from a scored run needs at least 2 attempts" }, { status: 400 });
    }

    let seed: StrutRunRow | null = null;
    let gtId: number;
    if (seedRunId) {
      seed = await findOpenHealthRunRow(member.workspaceId, seedRunId);
      if (!seed) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const seedGtId = (seed.input as { gtId?: unknown } | null)?.gtId;
      if (typeof seedGtId !== "number" || !Number.isInteger(seedGtId) || seedGtId <= 0) {
        return NextResponse.json({ error: "This run names no task" }, { status: 409 });
      }
      gtId = seedGtId;
    } else {
      if (typeof payload.gtId !== "number" || !Number.isInteger(payload.gtId) || payload.gtId <= 0) {
        return NextResponse.json({ error: "gtId must be a task id" }, { status: 400 });
      }
      gtId = payload.gtId;
    }
    const split = payload.split ?? OPENHEALTH_DEFAULT_SPLIT;
    if (!isOpenHealthSplit(split)) {
      return NextResponse.json({ error: 'split must be "public" or "heldout"' }, { status: 400 });
    }

    if (await hasRunningOpenHealthClimb(member.workspaceId, gtId)) {
      return NextResponse.json({ error: "A climb of this task is already running" }, { status: 409 });
    }
    if (await hasPendingOpenHealthRun(member.workspaceId, gtId)) {
      return NextResponse.json({ error: "A run of this task is already in progress" }, { status: 409 });
    }
    if (seed?.strutRunId && (await hasPendingOpenHealthImprove(member.workspaceId, seed.strutRunId))) {
      return NextResponse.json({ error: "An improve run of this run is already in progress" }, { status: 409 });
    }

    const rate = await checkRateLimit(`openhealth:climb:${member.workspaceId}`, CLIMB_RATE_LIMIT, CLIMB_WINDOW_SECS);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "Too many climbs started. Try again later." },
        { status: 429, headers: rate.retryAfter ? { "Retry-After": String(rate.retryAfter) } : undefined },
      );
    }

    if (!seed) {
      // Strut does not check the id up front: only a task the catalogue lists is launched.
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
    }

    const started = await startOpenHealthClimb({
      workspaceId: member.workspaceId,
      userId: member.userId,
      publicBaseUrl: getBaseUrl(request.headers.get("host")),
      gtId,
      targetF1,
      maxAttempts,
      seed,
    });
    return NextResponse.json({ success: true, climbId: started.climbId, runId: started.runId }, { status: 202 });
  } catch (error) {
    if (error instanceof OpenHealthClimbError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof StrutDispatchError) {
      const status = error.code === "no_target" || error.code === "unreachable" ? 503 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("[OpenHealth] climbs POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
