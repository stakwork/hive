/**
 * GET /api/workspaces/[slug]/legal/benchmarks/runs/[runId]/report/export
 *
 * Streams a self-contained ZIP archive of the run report for offline viewing.
 * Supports LEGAL_BENCHMARK_RUNNER, LEGAL_BENCHMARK_EVAL, and
 * LEGAL_BENCHMARK_RECURSION run types.
 *
 * ⚠️  IDOR — authorization is enforced BEFORE any sensitive field is read:
 *   1. Session → 401 if no userId.
 *   2. resolveWorkspaceAccess → requireMemberAccess → 403/404 if not a member.
 *   3. canReadRunReport(role) → 404 if VIEWER or STAKEHOLDER.
 *   4. DB WHERE clause includes id + workspaceId + type — a cross-workspace or
 *      wrong-type runId returns null with zero post-fetch ownership checks.
 *
 * reportUrl is fetched internally for loadRunReport but is NEVER emitted into
 * any response artifact (index.html, bundle.json, or log lines). Use safeUrlParts
 * for any URL-related logging.
 */

import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { StakworkRunType } from "@prisma/client";
import { canReadRunReport } from "@/lib/run-report/types";
import { assembleRunExport } from "@/lib/run-report/export/assemble";
import { buildContentDisposition } from "@/lib/run-report/export/content-disposition";
import { renderRunOffline } from "@/lib/run-report/export/render-offline";
import { assembleOfflineHtml } from "@/lib/run-report/export/offline-html";
import { safeUrlParts } from "@/lib/run-report/safe-url-log";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { fetchTaskRubricRoster } from "@/services/legal-benchmark-rubrics";
import { fetchFixSnapshots } from "@/services/legal-benchmark-fix-snapshots";

type RouteParams = {
  params: Promise<{ slug: string; runId: string }>;
};

// ── In-process fallback rate limiter ─────────────────────────────────────────
// Same pattern as src/app/api/workspaces/[slug]/runs/[runId]/report/route.ts.
// Applied ONLY when the primary Redis limiter errors.

const FALLBACK_WINDOW_MS = 60_000;
const FALLBACK_LIMIT = 5; // stricter than the report route — export is heavier

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

const LOG_SERVICE = "benchmark-export/runs";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { slug, runId } = await params;

  logger.info("[export/runs] Export request", LOG_SERVICE, { runId });

  try {
    // ── 1. Auth ───────────────────────────────────────────────────────────────
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) {
      return json({ error: "Unauthorized" }, 401);
    }
    const userId = userOrResponse.id;

    // ── 2. Workspace membership ───────────────────────────────────────────────
    const access = await resolveWorkspaceAccess(request, { slug });
    const member = requireMemberAccess(access);
    if (member instanceof NextResponse) {
      return json(await member.json(), member.status);
    }

    // ── 3. Role gate ──────────────────────────────────────────────────────────
    if (!canReadRunReport(member.role)) {
      return json({ error: "Not found" }, 404);
    }
    const workspaceId = member.workspaceId;

    // ── 4. Rate limiting ──────────────────────────────────────────────────────
    if (!checkFallbackLimit(userId)) {
      return json({ error: "Too many requests" }, 429);
    }
    try {
      const limit = await checkRateLimit(`benchmark-export:${userId}`, 10, 60);
      if (!limit.allowed) {
        return json({ error: "Too many requests", retryAfter: limit.retryAfter }, 429);
      }
    } catch (rateLimitError) {
      logger.warn("[export/runs] Rate limit unavailable — using fallback", LOG_SERVICE, {
        runId,
        error: String(rateLimitError),
      });
    }

    // ── 5. IDOR-guarded DB fetch ───────────────────────────────────────────────
    // id + workspaceId + type all in the WHERE clause. A cross-workspace or
    // wrong-type runId returns null — no post-fetch ownership check needed.
    const run = await db.stakworkRun.findFirst({
      where: {
        id: runId,
        workspaceId,
        type: {
          in: [
            StakworkRunType.LEGAL_BENCHMARK_RUNNER,
            StakworkRunType.LEGAL_BENCHMARK_EVAL,
            StakworkRunType.LEGAL_BENCHMARK_RECURSION,
          ],
        },
      },
      // reportUrl IS selected (opting through the global omit) for loadRunReport.
      // It is NEVER emitted into any artifact or log.
      select: { id: true, result: true, reportUrl: true, projectId: true },
    });

    if (!run) {
      return json({ error: "Not found" }, 404);
    }

    logger.info("[export/runs] Run found, assembling export", LOG_SERVICE, {
      runId,
      reportUrl: run.reportUrl ? safeUrlParts(run.reportUrl) : null,
    });

    // ── 6. Parse task metadata from result JSON ───────────────────────────────
    let taskTitle = "Run report";
    let taskSlug: string | null = null;
    try {
      const parsed = run.result
        ? (JSON.parse(run.result) as { taskTitle?: string; taskSlug?: string })
        : null;
      if (parsed?.taskTitle) taskTitle = parsed.taskTitle;
      if (parsed?.taskSlug) taskSlug = parsed.taskSlug;
    } catch {
      // Malformed result JSON — defaults are fine.
    }

    // ── 7. Swarm access for peek prefetch ─────────────────────────────────────
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    const swarmAccess = swarmResult.success ? swarmResult.data : null;

    // ── 8. Rubric roster + fix snapshots (non-fatal) ──────────────────────────
    let graphRubrics = null;
    let fixSnapshots = null;
    if (taskSlug) {
      const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
      if (jarvisConfig) {
        try {
          const rosterResult = await fetchTaskRubricRoster(jarvisConfig, taskSlug);
          if (rosterResult.ok) graphRubrics = rosterResult.roster?.rubrics ?? null;
        } catch {
          // Non-fatal — fall back to bundle-local scoring.
        }
        try {
          const snaps = await fetchFixSnapshots(jarvisConfig, taskSlug, {
            runId: run.id,
            projectId: run.projectId,
          });
          fixSnapshots = snaps.length > 0 ? snaps : null;
        } catch {
          // Non-fatal.
        }
      }
    }

    // ── 9. Assemble (loadRunReport + peek prefetch) ───────────────────────────
    const exportPayload = await assembleRunExport(runId, run.reportUrl, {
      swarmAccess: swarmAccess ?? {
        workspaceId,
        swarmName: "",
        swarmUrl: "",
        swarmApiKey: "",
        swarmStatus: "",
        poolName: "",
        swarmSecretAlias: null,
      },
      rubricRoster: graphRubrics,
      fixSnapshots,
    });

    logger.info("[export/runs] Assembly complete", LOG_SERVICE, {
      runId,
      skippedPeeks: exportPayload.skipped.peeks.length,
    });

    // ── 10. Render offline HTML ───────────────────────────────────────────────
    const renderResult = renderRunOffline({
      payload: exportPayload.report,
      taskTitle,
      graphRubrics: exportPayload.rubricRoster as import("@/lib/harvey-lab/rubric-scoring").GraphRubric[] | null,
      fixSnapshots: exportPayload.fixSnapshots as import("@/types/legal").FixSnapshotEntry[] | null,
      context: {
        peeks: exportPayload.peeks,
        packedDocsByUrl: new Map(),
        workspaceSlug: null, // no live fetches in offline mode
      },
    });

    // ── 11. Assemble HTML document + bundle.json ──────────────────────────────
    // projection must NOT contain reportUrl — it is already absent from
    // RunReportPayload (the payload only contains the sanitized projection).
    const { indexHtml, bundleJson } = assembleOfflineHtml(
      renderResult.markup,
      exportPayload.report.projection,
      taskTitle,
    );

    // ── 12. Build ZIP ─────────────────────────────────────────────────────────
    const zip = new JSZip();
    zip.file("index.html", indexHtml);
    zip.file("bundle.json", bundleJson);

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    logger.info("[export/runs] ZIP built", LOG_SERVICE, {
      runId,
      bytes: zipBuffer.length,
    });

    // ── 13. Content-Disposition ───────────────────────────────────────────────
    const disposition = buildContentDisposition(taskTitle, runId);

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/zip",
        "Content-Disposition": disposition,
        "Content-Length": String(zipBuffer.length),
      },
    });
  } catch (error) {
    logger.error("[export/runs] Export route failed", LOG_SERVICE, {
      runId,
      error: String(error),
    });
    return json({ error: "Failed to generate export" }, 500);
  }
}
