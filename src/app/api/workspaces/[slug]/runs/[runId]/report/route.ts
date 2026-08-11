/**
 * GET /api/workspaces/[slug]/runs/[runId]/report
 *
 * Returns the persisted, sanitized run report bundle projection.
 *
 * The view path performs an OUTBOUND FETCH to S3 on every request. The bundle
 * JSON is never copied into the database — only the URL is stored. `loadRunReport`
 * calls `fetchReportBundle` synchronously on each view, which means
 * `validateReportUrl` is a live, load-bearing SSRF control on every request.
 * Do not remove or weaken the URL guard in fetch-bundle.ts or url-guard.ts.
 *
 * `reportUrl` is never returned. It is additionally unreachable by default via
 * the global Prisma omit in src/lib/db.ts, so it cannot be leaked by accident
 * here or anywhere else.
 *
 * Authorization deliberately mirrors the sibling legal-benchmark routes'
 * *pattern* but explicitly rejects their *data shape*: that route does a
 * `findFirst` with no `select` and returns the entire row as `{ run, runnerRun }`.
 * Bundles carry converted legal source documents and agent transcripts, so a
 * leak here is a document-disclosure incident, not a nuisance.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { StakworkRunType } from "@prisma/client";
import { canReadRunReport } from "@/lib/run-report/types";
import { loadRunReport } from "@/lib/run-report/load";

type RouteParams = {
  params: Promise<{ slug: string; runId: string }>;
};

// ── In-process fallback rate limiter ──────────────────────────────────────
//
// Applied ONLY when the primary Redis limiter errors. Lossy across instances
// but provides a reasonable per-user bound during a limiter outage so a
// Redis failure cannot fan out to unbounded S3 fetches (MAX_BUNDLE_BYTES = 25 MB).

const FALLBACK_WINDOW_MS = 60_000;
const FALLBACK_LIMIT = 10;

const fallbackCounters = new Map<string, { count: number; resetAt: number }>();

function checkFallbackLimit(userId: string): boolean {
  const now = Date.now();
  const entry = fallbackCounters.get(userId);
  if (!entry || now >= entry.resetAt) {
    fallbackCounters.set(userId, { count: 1, resetAt: now + FALLBACK_WINDOW_MS });
    return true;
  }
  if (entry.count >= FALLBACK_LIMIT) return false;
  entry.count += 1;
  return true;
}

const LOG_SERVICE = "run-report/route";

/** Applied to every response, success and error alike. */
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { slug, runId } = await params;

    // Member access, NOT requireReadAccess: the latter admits public viewers,
    // and converted legal documents plus agent transcripts are not a
    // public-viewer artifact.
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireMemberAccess(access);
    if (member instanceof NextResponse) {
      return json(await member.json(), member.status);
    }

    // requireMemberAccess alone admits VIEWER and STAKEHOLDER; source documents
    // and agent transcripts are not a viewer-tier artifact, so require a
    // working role explicitly. See RUN_REPORT_ALLOWED_ROLES for why this is a
    // role check rather than the sibling routes' swarm gate.
    if (!canReadRunReport(member.role)) {
      return json({ error: "Not found" }, 404);
    }
    const workspaceId = member.workspaceId;

    // Rate limit keyed on the AUTHENTICATED SESSION USER, not the client IP.
    // getClientIp derives identity from the client-controlled x-forwarded-for
    // header, so an IP-keyed limit is trivially spoofed.
    //
    // Primary limiter (Redis): fails open on error so a Redis outage doesn't
    // 500 a read-only view. But "fail open" here means an unbounded outbound
    // S3 fetch on every call — so fall back to an in-process per-user counter
    // when Redis is unavailable. The in-process counter is lossy across
    // instances but provides a reasonable bound during a limiter outage.
    const fallbackAllowed = checkFallbackLimit(userOrResponse.id);
    if (!fallbackAllowed) {
      return json({ error: "Too many requests" }, 429);
    }
    try {
      const limit = await checkRateLimit(`run-report:${userOrResponse.id}:${runId}`, 60, 60);
      if (!limit.allowed) {
        return json({ error: "Too many requests", retryAfter: limit.retryAfter }, 429);
      }
    } catch (rateLimitError) {
      logger.warn("[run-report] Rate limit unavailable — using fallback", LOG_SERVICE, {
        runId,
        error: String(rateLimitError),
      });
    }

    // IDOR guard entirely in the WHERE clause — id, workspaceId AND type.
    // Without the type constraint, any run in the workspace that ever acquires
    // a reportUrl becomes fetchable through this endpoint. A cross-workspace
    // runId returns null with no post-fetch ownership check.
    const run = await db.stakworkRun.findFirst({
      where: {
        id: runId,
        workspaceId,
        type: { in: [StakworkRunType.LEGAL_BENCHMARK_RUNNER] },
      },
      // reportUrl IS selected here (opting through the global omit) because the
      // server needs it to fetch the bundle. It is never put in the response.
      select: { id: true, reportUrl: true },
    });

    if (!run) {
      return json({ error: "Not found" }, 404);
    }

    // Fetched and sanitized here, server-side. The URL does not go in the body.
    const payload = await loadRunReport(run.id, run.reportUrl);

    return json(payload, 200);
  } catch (error) {
    logger.error("[run-report] Report route failed", LOG_SERVICE, { error: String(error) });
    return json({ error: "Failed to load report" }, 500);
  }
}
