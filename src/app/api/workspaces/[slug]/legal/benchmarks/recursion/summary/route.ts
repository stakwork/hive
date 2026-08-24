/**
 * GET /api/workspaces/[slug]/legal/benchmarks/recursion/summary
 *
 * Batch summary endpoint for the Recursion tab. Returns rubric count,
 * fix-chain depth, and latest run score for all enrolled tasks in one
 * server-side request — eliminating the per-card Lambda stampede that hits
 * on mount when 30+ `RecursionCard` components each fire individual Jarvis
 * fetches.
 *
 * Auth chain (enforced in this exact order):
 *   1. requireAuth — 401 if unauthenticated; userId available after this step.
 *   2. Openlaw gate — 403 for non-openlaw slugs.
 *   3. Rate limit — 20 req/60s per ip:userId pair, FAIL-CLOSED (503 on Redis
 *      error). The summary endpoint fans out ~90 Jarvis calls per request, so
 *      fail-open during Redis unavailability recreates the stampede server-side.
 *   4. getWorkspaceSwarmAccess — validates workspace membership + swarm.
 *      workspaceId forwarded to listRecursionEvalSets to preserve Source 3.
 *
 * Gated to the `openlaw` workspace only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisUrl } from "@/lib/utils/swarm";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { listRecursionEvalSets } from "@/services/legal-benchmark-recursion";
import { fetchRecursionTaskSummary } from "@/services/legal-benchmark-recursion-summary";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

type RouteParams = { params: Promise<{ slug: string }> };

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] ?? { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

// ── USE_MOCKS fixture ─────────────────────────────────────────────────────────

function buildMockSummaryData() {
  return [
    {
      taskSlug: "mock-task-1",
      refId: "mock-evalset-ref-1",
      name: "Mock Task 1",
      reason: "active",
      recursion: true,
      rubricCount: 10,
      contestedCount: 1,
      latestRun: { n_passed: 7, n_total: 9, runAt: "1700000000" },
      fixChainDepth: 3,
      isDefault: false,
    },
    {
      taskSlug: "mock-task-2",
      refId: "mock-evalset-ref-2",
      name: "Mock Task 2",
      reason: "wasEnabled",
      recursion: false,
      rubricCount: 5,
      contestedCount: 0,
      latestRun: null,
      fixChainDepth: 0,
      isDefault: true,
    },
  ];
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    // Step 1: Auth — must be first; userId not safe to derive until authed
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const userId = userOrResponse.id;

    const { slug } = await params;

    // Step 2: Openlaw-only gate
    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 403 });
    }

    // Step 3: Rate limit — FAIL-CLOSED (503 on Redis error).
    // Key includes both ip and userId: ip alone can be spoofed via a
    // client-controlled x-forwarded-for header, bypassing the limit on an
    // endpoint that fans out ~90 Jarvis calls per request.
    const ip = getClientIp(request);
    let rl: { allowed: boolean; retryAfter?: number };
    try {
      rl = await checkRateLimit(`recursion-summary:get:${ip}:${userId}`, 20, 60);
    } catch (rateLimitError) {
      // Fail-CLOSED: Redis unavailable → 503. This differs from fix-chain
      // (single-task, fail-open) because a summary fan-out per request
      // during Redis outage would recreate the stampede server-side.
      logger.warn(
        "[legal/benchmarks/recursion/summary] Rate limit unavailable — failing closed",
        "legal",
        { error: String(rateLimitError) },
      );
      return NextResponse.json(
        { error: "Service unavailable — please retry shortly" },
        {
          status: 503,
          headers: { "Retry-After": "60" },
        },
      );
    }
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }

    // Step 4: Workspace swarm access (validates workspace membership + swarm).
    // workspaceId forwarded to listRecursionEvalSets so Source 3 (multi-run
    // history) is included — omitting it silently disables Source 3 without error.
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { swarmName, swarmApiKey, workspaceId } = swarmResult.data;
    const jarvisUrl = getJarvisUrl(swarmName);
    const config = { jarvisUrl, apiKey: swarmApiKey };

    // USE_MOCKS guard — return fixture response in dev/test mode.
    if (process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "production") {
      logger.info(
        "[legal/benchmarks/recursion/summary] USE_MOCKS=true, returning mock fixture",
        "legal",
        { slug },
      );
      return NextResponse.json({
        success: true,
        data: buildMockSummaryData(),
        summaryPartial: false,
      });
    }

    // Fetch all enrolled EvalSets (listRecursionEvalSets already deduplicates
    // across three sources and returns each entry's ref_id — no per-card slug
    // resolution needed).
    const listResult = await listRecursionEvalSets(config, workspaceId);

    if (!listResult.ok) {
      return NextResponse.json(
        { error: "Failed to fetch recursion eval sets" },
        { status: 502 },
      );
    }

    const entries = listResult.nodes ?? [];
    const enrolledCount = entries.length;

    logger.info(
      "[legal/benchmarks/recursion/summary] Fetching summary",
      "legal",
      { enrolledCount, slug },
    );

    // Fetch minimal initial-render data for all tasks in parallel.
    // Per-task failures are non-fatal — failed tasks return isDefault: true.
    const data = await fetchRecursionTaskSummary(config, entries);

    // Enrich latestRun.runAt with StakworkRun.updatedAt from Postgres — more
    // accurate than the graph's date_added_to_graph, which is written by Jarvis
    // and may lag or differ from the actual Stakwork run completion time.
    // One batched query across all enrolled EvalSets; per-evalSet we pick the
    // most recent updatedAt from any LEGAL_BENCHMARK_RUNNER run.
    try {
      const evalSetIds = entries.map((e) => e.ref_id).filter(Boolean);

      if (evalSetIds.length > 0) {
        // LEGAL_BENCHMARK_RUNNER runs store the task identity as taskSlug inside
        // the result JSON column — evalSetId is never populated for this run type.
        // Use a raw query to filter and group by the JSON path in one round trip.
        const taskSlugs = entries.map((e) => e.id).filter(Boolean);

        const rows = await db.$queryRaw<Array<{ task_slug: string; latest_updated_at: Date }>>`
          SELECT
            result::json->>'taskSlug' AS task_slug,
            MAX(updated_at)           AS latest_updated_at
          FROM stakwork_runs
          WHERE workspace_id   = ${workspaceId}
            AND type           = 'LEGAL_BENCHMARK_RUNNER'
            AND status         = 'COMPLETED'
            AND result::json->>'taskSlug' = ANY(${taskSlugs}::text[])
          GROUP BY result::json->>'taskSlug'
        `;

        // Build map: taskSlug → most recent updatedAt
        const latestUpdatedAt = new Map<string, Date>();
        for (const row of rows) {
          if (row.task_slug) {
            latestUpdatedAt.set(row.task_slug, row.latest_updated_at);
          }
        }

        // Overwrite runAt on each summary entry where we have a Postgres timestamp.
        // entry.id is the taskSlug for legal benchmark entries.
        for (const entry of data) {
          const updatedAt = latestUpdatedAt.get(entry.taskSlug);
          if (updatedAt) {
            if (entry.latestRun) {
              entry.latestRun.runAt = updatedAt.toISOString();
            } else {
              entry.latestRun = { n_passed: null, n_total: null, runAt: updatedAt.toISOString() };
            }
          }
        }
      }
    } catch (dbError) {
      // Non-fatal: fall back to graph-sourced runAt if Postgres is unavailable.
      logger.warn(
        "[legal/benchmarks/recursion/summary] Failed to enrich runAt from StakworkRun.updatedAt — falling back to graph timestamps",
        "legal",
        { error: dbError instanceof Error ? dbError.message : String(dbError) },
      );
    }

    const enrollmentPartial = listResult.partial === true;
    const summaryPartial = data.some((e) => e.isDefault);

    logger.info(
      "[legal/benchmarks/recursion/summary] Summary fetched",
      "legal",
      {
        summaryCount: data.length,
        enrollmentPartial,
        summaryPartial,
      },
    );

    return NextResponse.json({
      success: true,
      data,
      ...(enrollmentPartial ? { enrollmentPartial: true } : {}),
      ...(summaryPartial ? { summaryPartial: true } : {}),
    });
  } catch (error) {
    logger.error(
      "[legal/benchmarks/recursion/summary] GET error",
      "legal",
      { error: error instanceof Error ? error.message : String(error) },
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
