/**
 * GET /api/workspaces/[slug]/runs/[runId]/report
 *
 * Returns the persisted, sanitized run report bundle projection.
 *
 * The view path performs NO OUTBOUND FETCH. The bundle was fetched, sanitized,
 * redacted and projected once at webhook ingest; this route only authorizes and
 * serializes what is already in the database. That is what makes viewing
 * independent of the S3 object's continued existence.
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
import {
  canReadRunReport,
  type RunReportPayload,
  type RunReportProjection,
} from "@/lib/run-report/types";

type RouteParams = {
  params: Promise<{ slug: string; runId: string }>;
};

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
    // Fails OPEN on a Redis error: `redis.incr` is unguarded and the client is
    // constructed eagerly from `process.env.REDIS_URL!`, so an unavailable
    // Redis would otherwise 500 a read-only view path.
    try {
      const limit = await checkRateLimit(`run-report:${userOrResponse.id}:${runId}`, 60, 60);
      if (!limit.allowed) {
        return json({ error: "Too many requests", retryAfter: limit.retryAfter }, 429);
      }
    } catch (rateLimitError) {
      logger.warn("[run-report] Rate limit unavailable — failing open", LOG_SERVICE, {
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
      select: {
        id: true,
        reportBundle: true,
        reportPartial: true,
        reportSchemaUnsupported: true,
        // reportUrl deliberately NOT selected.
      },
    });

    if (!run) {
      return json({ error: "Not found" }, 404);
    }

    const payload: RunReportPayload = {
      runId: run.id,
      hasReport: run.reportBundle != null,
      partial: run.reportPartial,
      schemaUnsupported: run.reportSchemaUnsupported,
      projection: (run.reportBundle as unknown as RunReportProjection | null) ?? null,
    };

    return json(payload, 200);
  } catch (error) {
    logger.error("[run-report] Report route failed", LOG_SERVICE, { error: String(error) });
    return json({ error: "Failed to load report" }, 500);
  }
}
