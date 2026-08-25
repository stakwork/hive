/**
 * GET /api/workspaces/[slug]/legal/benchmarks/attempts/[refId]/report/export
 *
 * Streams a self-contained ZIP archive of a recursion-attempt report for
 * offline viewing. Attempt reports are graph-only (EvalTriggerOutput nodes)
 * — there is no StakworkRun row; the report_url is sourced from the node.
 *
 * ⚠️  IDOR — same gate sequence as the other export routes, plus an extra
 * node-type check (mirrors AttemptReportPage exactly):
 *   1. Session → 401
 *   2. resolveWorkspaceAccess → requireMemberAccess → 403/404
 *   3. canReadRunReport(role) → 404
 *   4. jarvisConfig → 404 if no swarm configured
 *   5. readNodeByRef scoped to the authenticated workspace's swarm → 404 on
 *      failure, or if the node is not an EvalTriggerOutput, or if it lacks
 *      report_url — an arbitrary node with report_url-shaped properties must
 *      not be reachable through this route.
 */

import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { resolveWorkspaceAccess, requireMemberAccess } from "@/lib/auth/workspace-access";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { canReadRunReport } from "@/lib/run-report/types";
import { assembleAttemptExport } from "@/lib/run-report/export/assemble";
import { buildContentDisposition } from "@/lib/run-report/export/content-disposition";
import { renderRunOffline } from "@/lib/run-report/export/render-offline";
import { assembleOfflineHtml } from "@/lib/run-report/export/offline-html";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { readNodeByRef } from "@/services/swarm/api/nodes";
import { fetchTaskRubricRoster } from "@/services/legal-benchmark-rubrics";
import { fetchFixSnapshots } from "@/services/legal-benchmark-fix-snapshots";

type RouteParams = {
  params: Promise<{ slug: string; refId: string }>;
};

// ── In-process fallback rate limiter ─────────────────────────────────────────
const FALLBACK_WINDOW_MS = 60_000;
const FALLBACK_LIMIT = 5;

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

const LOG_SERVICE = "benchmark-export/attempts";
const TASK_SLUG_RE = /^[a-z0-9_\-/]+$/i;
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { slug, refId } = await params;

  logger.info("[export/attempts] Export request", LOG_SERVICE, { refId });

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
      logger.warn("[export/attempts] Rate limit unavailable — using fallback", LOG_SERVICE, {
        refId,
        error: String(rateLimitError),
      });
    }

    // ── 5. Resolve jarvis config (required for node fetch) ────────────────────
    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return json({ error: "Not found" }, 404);
    }

    // ── 6. Node fetch — IDOR guard via workspace-scoped swarm ─────────────────
    // Node fetch is scoped to the authenticated workspace's own swarm config,
    // so a foreign ref_id cannot cross workspaces. The type check below rejects
    // any node that is not an EvalTriggerOutput — without it, any graph node
    // with a report_url-shaped property would become fetchable.
    const node = await readNodeByRef(jarvisConfig, refId);
    if (!node.success) {
      return json({ error: "Not found" }, 404);
    }
    if ((node.node_type ?? "").toLowerCase() !== "evaltriggeroutput") {
      return json({ error: "Not found" }, 404);
    }

    const rawReportUrl = node.properties?.report_url;
    const reportUrl =
      typeof rawReportUrl === "string" && rawReportUrl.trim() !== ""
        ? rawReportUrl.trim()
        : null;

    logger.info("[export/attempts] Node resolved", LOG_SERVICE, { refId });

    // ── 7. Optional task context from query string ────────────────────────────
    const { searchParams } = new URL(request.url);
    const taskParam = searchParams.get("task");
    const taskSlug =
      taskParam && TASK_SLUG_RE.test(taskParam) ? taskParam : null;
    const taskTitle = taskSlug ?? "Attempt report";

    // ── 8. Swarm access for peek prefetch ─────────────────────────────────────
    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    const swarmAccess = swarmResult.success ? swarmResult.data : null;

    // ── 9. Rubric roster + fix snapshots (non-fatal) ──────────────────────────
    let graphRubrics = null;
    let fixSnapshots = null;
    if (taskSlug) {
      try {
        const rosterResult = await fetchTaskRubricRoster(jarvisConfig, taskSlug);
        if (rosterResult.ok) graphRubrics = rosterResult.roster?.rubrics ?? null;
      } catch {
        // Non-fatal.
      }
      try {
        const snaps = await fetchFixSnapshots(jarvisConfig, taskSlug);
        fixSnapshots = snaps.length > 0 ? snaps : null;
      } catch {
        // Non-fatal.
      }
    }

    // ── 10. Assemble (loadRunReport + peek prefetch) ──────────────────────────
    const exportPayload = await assembleAttemptExport(refId, reportUrl, {
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

    logger.info("[export/attempts] Assembly complete", LOG_SERVICE, {
      refId,
      skippedPeeks: exportPayload.skipped.peeks.length,
    });

    // ── 11. Render offline HTML ───────────────────────────────────────────────
    const renderResult = renderRunOffline({
      payload: exportPayload.report,
      taskTitle,
      graphRubrics: exportPayload.rubricRoster as import("@/lib/harvey-lab/rubric-scoring").GraphRubric[] | null,
      fixSnapshots: exportPayload.fixSnapshots as import("@/types/legal").FixSnapshotEntry[] | null,
      context: {
        peeks: exportPayload.peeks,
        packedDocsByUrl: new Map(),
        workspaceSlug: null,
      },
    });

    // ── 12. Assemble HTML document + bundle.json ──────────────────────────────
    const { indexHtml, bundleJson } = assembleOfflineHtml(
      renderResult.markup,
      exportPayload.report.projection,
      taskTitle,
    );

    // ── 13. Build ZIP ─────────────────────────────────────────────────────────
    const zip = new JSZip();
    zip.file("index.html", indexHtml);
    zip.file("bundle.json", bundleJson);

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    logger.info("[export/attempts] ZIP built", LOG_SERVICE, {
      refId,
      bytes: zipBuffer.length,
    });

    // ── 14. Content-Disposition ───────────────────────────────────────────────
    const disposition = buildContentDisposition(taskTitle, refId);

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
    logger.error("[export/attempts] Export route failed", LOG_SERVICE, {
      refId,
      error: String(error),
    });
    return json({ error: "Failed to generate export" }, 500);
  }
}
