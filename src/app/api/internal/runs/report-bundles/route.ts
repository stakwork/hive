/**
 * POST /api/internal/runs/report-bundles
 *
 * Internal endpoint called by workflow 58345 to pull S3 report bundle content
 * for a set of run IDs. Authentication is via a HMAC token computed over
 * `workspaceId + sorted(runIds).join(",")` using INTERNAL_BUNDLE_API_SECRET.
 *
 * This endpoint is ONLY needed when workflow 58345 uses a pull-bundle callback
 * pattern. If the workflow pushes `report_url` directly on its completion
 * webhook (as LEGAL_BENCHMARK_RUNNER does), this endpoint is unused.
 *
 * Security model:
 * - `bundle_token` = HMAC(INTERNAL_BUNDLE_API_SECRET, sortedRunIds.join(",") + ":" + workspaceId)
 * - The trigger endpoint (consolidated-report/route.ts) computes and forwards
 *   bundle_token to the workflow as a var; the workflow echoes it back here.
 * - Any modification to runIds or workspaceId invalidates the token → 401.
 * - All runIds are scope-checked against workspaceId in a single DB query.
 * - Hard cap of 20 runIds per call (trigger endpoint allows up to 50, but pull
 *   calls should be batched by the workflow if needed).
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { StakworkRunType } from "@prisma/client";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { loadRunReport } from "@/lib/run-report/load";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

const INTERNAL_BUNDLE_RUN_TYPES: StakworkRunType[] = [
  StakworkRunType.LEGAL_BENCHMARK_RUNNER,
  StakworkRunType.LEGAL_BENCHMARK_EVAL,
  StakworkRunType.LEGAL_BENCHMARK_RECURSION,
  StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED,
];

/** Maximum runIds accepted per call. */
const MAX_RUN_IDS = 20;

/** Maximum concurrent S3 fetches. */
const FETCH_CONCURRENCY = 5;

export async function POST(request: NextRequest) {
  try {
    // ── Rate limiting ───────────────────────────────────────────────────────
    const ip = getClientIp(request);
    const rl = await checkRateLimit(`internal-report-bundles:post:${ip}`, 10, 60);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    // ── Parse body ──────────────────────────────────────────────────────────
    let body: { runIds?: unknown; workspaceId?: unknown; token?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { runIds, workspaceId, token } = body;

    if (!Array.isArray(runIds) || runIds.length === 0) {
      return NextResponse.json({ error: "runIds must be a non-empty array" }, { status: 400 });
    }
    if (runIds.length > MAX_RUN_IDS) {
      return NextResponse.json(
        { error: `runIds exceeds maximum of ${MAX_RUN_IDS} per call` },
        { status: 400 },
      );
    }
    if (typeof workspaceId !== "string" || !workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }
    if (typeof token !== "string" || !token) {
      return NextResponse.json({ error: "token is required" }, { status: 401 });
    }
    const typedRunIds = runIds as string[];

    // ── Verify HMAC bundle_token ────────────────────────────────────────────
    // Token = HMAC(INTERNAL_BUNDLE_API_SECRET, sortedRunIds.join(",") + ":" + workspaceId)
    //
    // Fail closed when the secret is unconfigured: an empty-string key still
    // produces a deterministic HMAC that an attacker who knows the construction
    // could compute without any secret. Hard-reject rather than accept it.
    const bundleSecret = process.env.INTERNAL_BUNDLE_API_SECRET;
    if (!bundleSecret) {
      logger.error("[internal/report-bundles] INTERNAL_BUNDLE_API_SECRET not configured", "internal-report-bundles", {});
      return NextResponse.json({ error: "Service misconfigured" }, { status: 503 });
    }

    const sortedRunIds = [...typedRunIds].sort();
    const expected = createHmac("sha256", bundleSecret)
      .update(sortedRunIds.join(",") + ":" + workspaceId)
      .digest("hex");

    let tokenValid = false;
    try {
      if (token.length === expected.length) {
        tokenValid = timingSafeEqual(
          Buffer.from(token, "hex"),
          Buffer.from(expected, "hex"),
        );
      }
    } catch {
      tokenValid = false;
    }

    if (!tokenValid) {
      logger.warn("[internal/report-bundles] Invalid bundle_token", "internal-report-bundles", {
        workspaceId,
        runIdCount: typedRunIds.length,
      });
      return NextResponse.json({ error: "Unauthorized: invalid bundle token" }, { status: 401 });
    }

    // ── IDOR: fetch only runs belonging to this workspaceId ─────────────────
    const resolvedRuns = await db.stakworkRun.findMany({
      where: {
        id: { in: typedRunIds },
        workspaceId,
        type: { in: INTERNAL_BUNDLE_RUN_TYPES },
      },
      select: { id: true, reportUrl: true },
    });

    const resolvedMap = new Map(resolvedRuns.map((r) => [r.id, r]));

    // ── Fetch bundles concurrently (bounded concurrency) ───────────────────
    // Process in batches of FETCH_CONCURRENCY using a simple semaphore pattern.
    const results: Array<{ runId: string; content: string | null; error?: string }> = [];

    async function fetchOne(runId: string): Promise<{ runId: string; content: string | null; error?: string }> {
      const row = resolvedMap.get(runId);
      if (!row) {
        // Not found or belongs to a different workspace — return null silently
        return { runId, content: null, error: "not_found" };
      }
      if (!row.reportUrl) {
        return { runId, content: null };
      }
      try {
        const payload = await loadRunReport(runId, row.reportUrl);
        // Return raw JSON text for the workflow to parse its own way
        return { runId, content: payload.projection ? JSON.stringify(payload.projection) : null };
      } catch (err) {
        logger.error("[internal/report-bundles] Failed to load bundle", "internal-report-bundles", {
          runId,
          error: String(err),
        });
        return { runId, content: null, error: "fetch_failed" };
      }
    }

    // Process in batches of FETCH_CONCURRENCY
    for (let i = 0; i < typedRunIds.length; i += FETCH_CONCURRENCY) {
      const batch = typedRunIds.slice(i, i + FETCH_CONCURRENCY);
      const batchResults = await Promise.allSettled(batch.map(fetchOne));
      for (const settled of batchResults) {
        if (settled.status === "fulfilled") {
          results.push(settled.value);
        } else {
          // Should not happen since fetchOne never throws, but handle defensively
          results.push({ runId: "unknown", content: null, error: "unexpected" });
        }
      }
    }

    return NextResponse.json({ bundles: results }, { status: 200 });
  } catch (error) {
    logger.error("[internal/report-bundles POST] Unexpected error", "internal-report-bundles", {
      error: String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
