import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { OPENHEALTH_READ_RATE_LIMIT } from "@/lib/openhealth-benchmarks/constants";
import { resolveOpenHealthStrut, fetchOwnedRun } from "@/lib/openhealth-benchmarks/strut-client";
import { projectRunSummary } from "@/lib/openhealth-benchmarks/run-summary";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

const LOG_TAG = "openhealth-benchmarks";

type RouteParams = { params: Promise<{ slug: string; runId: string }> };

/**
 * GET /api/workspaces/[slug]/openhealth/benchmarks/runs/[runId]
 *
 * `fetchOwnedRun` (IDOR gate — a foreign or unknown run is 404) then project.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { slug, runId } = await params;
    const resolved = await resolveOpenHealthStrut(request, slug, { write: false });
    if (!resolved.ok) return resolved.response;
    const { target, userId } = resolved;

    let rl: { allowed: boolean; retryAfter?: number };
    try {
      rl = await checkRateLimit(
        `openhealth-benchmark-run-detail:${userId}`,
        OPENHEALTH_READ_RATE_LIMIT.limit,
        OPENHEALTH_READ_RATE_LIMIT.windowSecs,
      );
    } catch {
      return NextResponse.json({ error: "Rate limit service unavailable" }, { status: 503 });
    }
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests", retryAfter: rl.retryAfter }, { status: 429 });
    }

    const owned = await fetchOwnedRun(target, runId);
    if (!owned.ok) return owned.response;

    return NextResponse.json(projectRunSummary(owned.summary));
  } catch (error) {
    logger.error("[openhealth/benchmarks/runs/[runId] GET] Unexpected error", LOG_TAG, {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
