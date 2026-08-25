/**
 * GET /api/workspaces/[slug]/legal/benchmarks/consolidated/[runId]/report/export
 *
 * Streams a self-contained ZIP archive of a consolidated run report for offline
 * viewing. Restricted to LEGAL_BENCHMARK_CONSOLIDATED run type.
 *
 * ⚠️  IDOR — same gate sequence as the runs export route:
 *   1. Session → 401
 *   2. resolveWorkspaceAccess → requireMemberAccess → 403/404
 *   3. canReadRunReport(role) → 404
 *   4. DB WHERE: id + workspaceId + type=CONSOLIDATED (wrong type → null)
 *
 * reportUrl is used only internally; never emitted into any artifact.
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
import { assembleConsolidatedExport } from "@/lib/run-report/export/assemble";
import { buildContentDisposition } from "@/lib/run-report/export/content-disposition";
import { renderConsolidatedOffline } from "@/lib/run-report/export/render-offline";
import { assembleOfflineHtml } from "@/lib/run-report/export/offline-html";
import { safeUrlParts } from "@/lib/run-report/safe-url-log";

type RouteParams = {
  params: Promise<{ slug: string; runId: string }>;
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

const LOG_SERVICE = "benchmark-export/consolidated";
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { slug, runId } = await params;

  logger.info("[export/consolidated] Export request", LOG_SERVICE, { runId });

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
      logger.warn("[export/consolidated] Rate limit unavailable — using fallback", LOG_SERVICE, {
        runId,
        error: String(rateLimitError),
      });
    }

    // ── 5. IDOR-guarded DB fetch ───────────────────────────────────────────────
    const run = await db.stakworkRun.findFirst({
      where: {
        id: runId,
        workspaceId,
        type: StakworkRunType.LEGAL_BENCHMARK_CONSOLIDATED,
      },
      select: { id: true, result: true, reportUrl: true },
    });

    if (!run) {
      return json({ error: "Not found" }, 404);
    }

    logger.info("[export/consolidated] Run found, assembling export", LOG_SERVICE, {
      runId,
      reportUrl: run.reportUrl ? safeUrlParts(run.reportUrl) : null,
    });

    // ── 6. Parse task slug from result JSON ───────────────────────────────────
    let taskSlug = "consolidated-report";
    try {
      const parsed = run.result
        ? (JSON.parse(run.result) as { taskSlug?: string })
        : null;
      if (parsed?.taskSlug) taskSlug = parsed.taskSlug;
    } catch {
      // Malformed result JSON — default is fine.
    }

    // ── 7. Assemble (loadRunReport + document packing) ────────────────────────
    const exportPayload = await assembleConsolidatedExport(runId, run.reportUrl, {});

    logger.info("[export/consolidated] Assembly complete", LOG_SERVICE, {
      runId,
      packedDocs: exportPayload.packedDocuments.length,
      skippedDocs: exportPayload.skipped.documents.length,
    });

    // ── 8. Render offline HTML ────────────────────────────────────────────────
    const renderResult = await renderConsolidatedOffline({
      payload: exportPayload.report,
      taskSlug,
      packedDocuments: exportPayload.packedDocuments,
      context: {
        peeks: new Map(),
        packedDocsByUrl: new Map(exportPayload.packedDocuments.map((d) => [d.url, d.entryName])),
        workspaceSlug: null,
      },
    });

    // ── 9. Assemble HTML document + bundle.json ───────────────────────────────
    const displayTitle = `Consolidated — ${taskSlug}`;
    const { indexHtml, bundleJson } = assembleOfflineHtml(
      renderResult.markup,
      exportPayload.report.projection,
      displayTitle,
    );

    // ── 10. Build ZIP ─────────────────────────────────────────────────────────
    const zip = new JSZip();
    zip.file("index.html", indexHtml);
    zip.file("bundle.json", bundleJson);

    // Pack source documents under documents/
    for (const doc of exportPayload.packedDocuments) {
      zip.file(`documents/${doc.entryName}`, doc.bytes);
    }

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    logger.info("[export/consolidated] ZIP built", LOG_SERVICE, {
      runId,
      bytes: zipBuffer.length,
      documentEntries: exportPayload.packedDocuments.length,
    });

    // ── 11. Content-Disposition ───────────────────────────────────────────────
    const disposition = buildContentDisposition(displayTitle, runId);

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
    logger.error("[export/consolidated] Export route failed", LOG_SERVICE, {
      runId,
      error: String(error),
    });
    return json({ error: "Failed to generate export" }, 500);
  }
}
