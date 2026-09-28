import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import {
  isOpenHealthSplit,
  OPENHEALTH_READ_RATE_LIMIT,
  OPENHEALTH_TASKS_DISPATCH_RATE_LIMIT,
  bodyHasGoldKey,
} from "@/lib/openhealth-benchmarks/constants";
import { resolveOpenHealthStrut, OPENHEALTH_WORKFLOWS } from "@/lib/openhealth-benchmarks/strut-client";
import { resolveCachedTaskList } from "@/lib/openhealth-benchmarks/task-cache";
import { strutFetch } from "@/lib/strut/fetch";
import { ensureStrutDelegation } from "@/services/bifrost/strut-delegation";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

const LOG_TAG = "openhealth-benchmarks";

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * GET /api/workspaces/[slug]/openhealth/benchmarks/tasks?split=public|heldout
 *
 * The task list for a split, read entirely from cached `openhealth-list-tasks`
 * strut run history — see `resolveCachedTaskList`. No refresh is triggered
 * by a GET; use POST for that.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const resolved = await resolveOpenHealthStrut(request, slug, { write: false });
    if (!resolved.ok) return resolved.response;
    const { target, userId } = resolved;

    let rl: { allowed: boolean; retryAfter?: number };
    try {
      rl = await checkRateLimit(
        `openhealth-benchmark-tasks:${userId}`,
        OPENHEALTH_READ_RATE_LIMIT.limit,
        OPENHEALTH_READ_RATE_LIMIT.windowSecs,
      );
    } catch {
      return NextResponse.json({ error: "Rate limit service unavailable" }, { status: 503 });
    }
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests", retryAfter: rl.retryAfter }, { status: 429 });
    }

    const url = new URL(request.url);
    const splitParam = url.searchParams.get("split");
    if (!isOpenHealthSplit(splitParam)) {
      return NextResponse.json({ error: 'split must be "public" or "heldout"' }, { status: 400 });
    }

    const result = await resolveCachedTaskList(target, splitParam);

    return NextResponse.json({
      tasks: result.tasks,
      sourceRunId: result.sourceRunId,
      fetchedAt: result.fetchedAt,
      refreshing: result.refreshing,
    });
  } catch (error) {
    logger.error("[openhealth/benchmarks/tasks GET] Unexpected error", LOG_TAG, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface RefreshBody {
  split?: unknown;
}

/**
 * POST /api/workspaces/[slug]/openhealth/benchmarks/tasks { split }
 *
 * Dispatches a fresh `openhealth-list-tasks` run for one split. Writers
 * only. Each call adds a strut run — there is no automatic reload; the UI
 * polls the GET route until this run's `sourceRunId` is picked up.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const resolved = await resolveOpenHealthStrut(request, slug, { write: true });
    if (!resolved.ok) return resolved.response;
    const { target, userId } = resolved;

    let rl: { allowed: boolean; retryAfter?: number };
    try {
      rl = await checkRateLimit(
        `openhealth-benchmark-tasks-refresh:${userId}`,
        OPENHEALTH_TASKS_DISPATCH_RATE_LIMIT.limit,
        OPENHEALTH_TASKS_DISPATCH_RATE_LIMIT.windowSecs,
      );
    } catch {
      return NextResponse.json({ error: "Rate limit service unavailable" }, { status: 503 });
    }
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests", retryAfter: rl.retryAfter }, { status: 429 });
    }

    let body: RefreshBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const goldKey = bodyHasGoldKey(body);
    if (goldKey) {
      logger.info("[openhealth/benchmarks/tasks] rejected gold-shaped key", LOG_TAG, { userId, key: goldKey });
      return NextResponse.json(
        { error: `Request body must not include a gold-shaped key: "${goldKey}"` },
        { status: 400 },
      );
    }

    if (!isOpenHealthSplit(body.split)) {
      return NextResponse.json({ error: 'split must be "public" or "heldout"' }, { status: 400 });
    }
    const split = body.split;

    const delegation = await ensureStrutDelegation(
      { workspaceId: target.workspaceId, workspaceSlug: target.workspaceSlug, userId },
      { swarmUrl: target.swarmUrl, swarmApiKey: target.swarmApiKey },
      { actor: target.actor },
    );
    if (delegation.status !== "fresh" && delegation.status !== "pushed") {
      return NextResponse.json({ error: "Strut delegation unavailable" }, { status: 503 });
    }

    let strutResponse: Response;
    try {
      strutResponse = await strutFetch(target, `/workflows/${encodeURIComponent(OPENHEALTH_WORKFLOWS.listTasks)}/run`, {
        method: "POST",
        body: { input: { split } },
      });
    } catch {
      return NextResponse.json({ error: "Failed to dispatch job to strut" }, { status: 502 });
    }
    if (!strutResponse.ok) {
      return NextResponse.json({ error: "Failed to dispatch job to strut" }, { status: 502 });
    }

    const strutData = (await strutResponse.json().catch(() => ({}))) as { runId?: unknown };
    const runId = typeof strutData.runId === "string" ? strutData.runId : null;

    logger.info("[openhealth/benchmarks/tasks] refresh dispatched", LOG_TAG, { userId, split, runId });

    return NextResponse.json({ runId }, { status: 202 });
  } catch (error) {
    logger.error("[openhealth/benchmarks/tasks POST] Unexpected error", LOG_TAG, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
