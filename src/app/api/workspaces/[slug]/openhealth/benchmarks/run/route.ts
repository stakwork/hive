import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { withLock, LockAcquireTimeoutError } from "@/lib/locks/redis-lock";
import { ensureStrutDelegation } from "@/services/bifrost/strut-delegation";
import { strutFetch } from "@/lib/strut/fetch";
import { OPENHEALTH_RUN_RATE_LIMIT, bodyHasGoldKey } from "@/lib/openhealth-benchmarks/constants";
import {
  resolveOpenHealthStrut,
  fetchRunDetailForWorkflow,
  listWorkflowRuns,
  OPENHEALTH_WORKFLOWS,
} from "@/lib/openhealth-benchmarks/strut-client";
import { findCachedTaskRow } from "@/lib/openhealth-benchmarks/task-cache";
import { normalizeGtId } from "@/lib/openhealth-benchmarks/run-summary";
import { batchedAll } from "@/lib/openhealth-benchmarks/concurrency";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

const LOG_TAG = "openhealth-benchmarks";

type RouteParams = { params: Promise<{ slug: string }> };

/** Only this one key may appear in the request body. */
const GTID_FORMAT_RE = /^[A-Za-z0-9_-]{1,64}$/;

const LIVE_STATUSES = new Set(["running", "pausing", "paused", "cancelling"]);
/** Bound on how many candidate active runs we resolve detail for per dispatch. */
const DUPLICATE_CHECK_CONCURRENCY = 5;
/** Lock TTL — held until strut's dispatch POST returns. */
const LOCK_TTL_MS = 30_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 8_000;

interface RunBody {
  gtId?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * POST /api/workspaces/[slug]/openhealth/benchmarks/run { gtId }
 *
 * Dispatches exactly one `openhealth-run` strut run for a case already
 * present in a cached public/heldout task list. No DB writes — the strut
 * IS the run record; Hive only checks the cached task list and the strut's
 * own live-run list before dispatching.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;

    // 1. write access (+ slug gate + strut resolution)
    const resolved = await resolveOpenHealthStrut(request, slug, { write: true });
    if (!resolved.ok) return resolved.response;
    const { target, userId } = resolved;

    // 2. rate limit — fail closed, before any body parsing or strut call.
    let rl: { allowed: boolean; retryAfter?: number };
    try {
      rl = await checkRateLimit(
        `openhealth-benchmark-run:${userId}`,
        OPENHEALTH_RUN_RATE_LIMIT.limit,
        OPENHEALTH_RUN_RATE_LIMIT.windowSecs,
      );
    } catch {
      return NextResponse.json({ error: "Rate limit service unavailable" }, { status: 503 });
    }
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests", retryAfter: rl.retryAfter }, { status: 429 });
    }

    // 3. body: only `gtId` allowed, plus a recursive gold-key scan.
    let body: RunBody;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const extraKeys = Object.keys(body).filter((k) => k !== "gtId");
    if (extraKeys.length > 0) {
      return NextResponse.json({ error: `Unexpected field: "${extraKeys[0]}"` }, { status: 400 });
    }
    const goldKey = bodyHasGoldKey(body);
    if (goldKey) {
      logger.info("[openhealth/benchmarks/run] rejected gold-shaped key", LOG_TAG, { userId, key: goldKey });
      return NextResponse.json(
        { error: `Request body must not include a gold-shaped key: "${goldKey}"` },
        { status: 400 },
      );
    }

    // 4. gtId format.
    const gtIdRaw = body.gtId;
    if (typeof gtIdRaw !== "string" && typeof gtIdRaw !== "number") {
      return NextResponse.json({ error: "gtId is required" }, { status: 400 });
    }
    const gtId = String(gtIdRaw);
    if (!GTID_FORMAT_RE.test(gtId)) {
      logger.info("[openhealth/benchmarks/run] rejected gtId format", LOG_TAG, { userId, gtId });
      return NextResponse.json({ error: "Invalid gtId" }, { status: 400 });
    }

    // 5. gtId must be in a cached public/heldout list — keeps `train` cases
    // (never listed) undispatchable, and prevents a client-invented id from
    // reaching strut with a fabricated workdir.
    const cached = await findCachedTaskRow(target, gtId);
    if (!cached) {
      return NextResponse.json({ error: "gtId is not in a cached task list" }, { status: 400 });
    }

    // 6. standing strut delegation — never spend the workspace swarm key
    // without a confirmed delegation.
    const delegation = await ensureStrutDelegation(
      { workspaceId: target.workspaceId, workspaceSlug: target.workspaceSlug, userId },
      { swarmUrl: target.swarmUrl, swarmApiKey: target.swarmApiKey },
      { actor: target.actor },
    );
    if (delegation.status !== "fresh" && delegation.status !== "pushed") {
      return NextResponse.json({ error: "Strut delegation unavailable" }, { status: 503 });
    }

    // 7 & 8: duplicate-run guard + dispatch, inside the per-gtId lock. The
    // lock is held until strut's POST returns, closing the check-then-act
    // race across concurrent callers.
    try {
      return await withLock(
        `openhealth:run:${gtId}`,
        () => dispatchRun(target, gtId, cached.nativeGtId, userId),
        { ttlMs: LOCK_TTL_MS, acquireTimeoutMs: LOCK_ACQUIRE_TIMEOUT_MS },
      );
    } catch (err) {
      if (err instanceof LockAcquireTimeoutError) {
        logger.info("[openhealth/benchmarks/run] lock contention", LOG_TAG, { userId, gtId });
        return NextResponse.json({ error: "A run is already starting for this case" }, { status: 409 });
      }
      throw err;
    }
  } catch (error) {
    logger.error("[openhealth/benchmarks/run POST] Unexpected error", LOG_TAG, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * The locked section: list `openhealth-run` runs, resolve every live/
 * ambiguous candidate's gtId with bounded concurrency, 409 on a match, then
 * dispatch. Any list or detail failure aborts with 503 — never dispatch on
 * an uncertain duplicate check.
 */
async function dispatchRun(
  target: Parameters<typeof fetchRunDetailForWorkflow>[0],
  gtId: string,
  nativeGtId: string | number,
  userId: string,
): Promise<NextResponse> {
  const workflow = OPENHEALTH_WORKFLOWS.run;

  const listed = await listWorkflowRuns(target, workflow);
  if (!listed.ok) {
    return NextResponse.json({ error: "Strut unavailable" }, { status: 503 });
  }

  const candidates = listed.runs.filter((r) => {
    const status = typeof r.status === "string" ? r.status : undefined;
    const hasInput = isRecord(r.input);
    return status === undefined || LIVE_STATUSES.has(status) || !hasInput;
  });

  let duplicateFound = false;
  let detailFetchFailed = false;

  await batchedAll(
    candidates.map((candidate) => async () => {
      if (duplicateFound || detailFetchFailed) return;
      let detail: Record<string, unknown> | null;
      if (isRecord(candidate.input)) {
        detail = candidate as unknown as Record<string, unknown>;
      } else {
        detail = await fetchRunDetailForWorkflow(target, workflow, candidate.runId);
      }
      if (detail === null) {
        detailFetchFailed = true;
        return;
      }
      const input = isRecord(detail.input) ? detail.input : {};
      const output = isRecord(detail.output) ? detail.output : {};
      const candidateGtId = normalizeGtId({ input, output });
      if (candidateGtId === gtId) {
        duplicateFound = true;
      }
    }),
    DUPLICATE_CHECK_CONCURRENCY,
  );

  if (detailFetchFailed) {
    return NextResponse.json({ error: "Strut unavailable" }, { status: 503 });
  }
  if (duplicateFound) {
    logger.info("[openhealth/benchmarks/run] duplicate run rejected", LOG_TAG, { userId, gtId });
    return NextResponse.json({ error: "A run is already in progress for this case" }, { status: 409 });
  }

  const workdir = `gt-${gtId}`;
  let strutResponse: Response;
  try {
    strutResponse = await strutFetch(target, `/workflows/${encodeURIComponent(workflow)}/run`, {
      method: "POST",
      body: { input: { gtId: nativeGtId, workdir } },
    });
  } catch {
    return NextResponse.json({ error: "Failed to dispatch job to strut" }, { status: 502 });
  }
  if (!strutResponse.ok) {
    return NextResponse.json({ error: "Failed to dispatch job to strut" }, { status: 502 });
  }

  const strutData = (await strutResponse.json().catch(() => ({}))) as { runId?: unknown };
  const runId = typeof strutData.runId === "string" ? strutData.runId : null;

  logger.info("[openhealth/benchmarks/run] dispatched", LOG_TAG, { userId, gtId, runId });

  return NextResponse.json({ runId }, { status: 202 });
}
