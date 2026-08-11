/**
 * Ingest-time capture of a run report bundle.
 *
 * Fetch happens HERE, at webhook ingest — not at view time. The view path
 * performs no outbound fetch at all, which removes per-request latency, the
 * concurrent-miss duplicate-fetch problem, unbounded per-instance heap growth,
 * and the outbound-fetch amplification surface of an authenticated read
 * endpoint. It also means a bundle whose S3 object is later deleted or moved
 * still renders.
 *
 * Tolerant by construction, because the producer-side workflow that emits
 * `report_url` is a separate, not-yet-landed change: a missing `report_url` is
 * a no-op, and an unparseable or version-mismatched bundle degrades to a
 * "report unavailable" state rather than failing the run. The report bundle is
 * an AUXILIARY artifact — failing an otherwise-successful benchmark run because
 * its report pointer was malformed would invert this feature's own priority of
 * preserving reports on runs that already failed.
 */

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { validateReportUrl } from "./url-guard";
import { safeUrlParts } from "./safe-url-log";
import { fetchReportBundle, BundleFetchError } from "./fetch-bundle";
import { projectBundle } from "./project";
import type { Prisma } from "@prisma/client";

const LOG_SERVICE = "run-report/ingest";

/**
 * Validate a `report_url` for storage. Returns the URL to persist, or a reason
 * code. Never returns or logs the URL on the rejection path.
 */
export function screenReportUrl(
  raw: unknown,
  runId: string,
): { ok: true; url: string } | { ok: false; reason: string } {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "absent" };
  }

  const guard = validateReportUrl(raw.trim());
  if (!guard.ok) {
    logger.error("[run-report] report_url rejected", LOG_SERVICE, {
      runId,
      reason: guard.reason,
    });
    return { ok: false, reason: guard.reason };
  }

  return { ok: true, url: raw.trim() };
}

/**
 * Fetch, sanitize and persist the bundle projection for a run.
 *
 * Never throws: every failure is recorded as a rejection reason on the run and
 * logged. Intended to be called from `after()` so the webhook acks immediately.
 */
export async function ingestReportBundle(runId: string, url: string): Promise<void> {
  const { host, pathHash } = safeUrlParts(url);

  try {
    const { text, hash } = await fetchReportBundle(url);
    const outcome = projectBundle(text);

    if (outcome.status === "unparseable") {
      logger.error("[run-report] Bundle unparseable", LOG_SERVICE, { runId, host, pathHash });
      await recordRejection(runId, "unparseable");
      return;
    }

    if (outcome.status === "unsupported_schema") {
      logger.error("[run-report] Bundle schema_version unsupported", LOG_SERVICE, {
        runId,
        host,
        pathHash,
        version: outcome.version,
      });
      await db.stakworkRun.update({
        where: { id: runId },
        data: {
          reportBundleHash: hash,
          reportSchemaUnsupported: true,
          reportRejectionReason: `unsupported_schema_v${outcome.version}`,
        },
      });
      return;
    }

    const { projection, droppedElements } = outcome;

    await db.stakworkRun.update({
      where: { id: runId },
      data: {
        reportBundle: projection as unknown as Prisma.InputJsonValue,
        reportBundleHash: hash,
        reportPartial: projection.partial,
        reportSchemaUnsupported: false,
        reportRejectionReason: null,
      },
    });

    logger.info("[run-report] Bundle persisted", LOG_SERVICE, {
      runId,
      host,
      pathHash,
      sourceDocs: projection.stats.sourceDocCount,
      droppedElements,
      partial: projection.partial,
    });
  } catch (err) {
    const reason = err instanceof BundleFetchError ? err.reason : "unknown";
    logger.error("[run-report] Bundle ingest failed", LOG_SERVICE, { runId, host, pathHash, reason });
    await recordRejection(runId, reason);
  }
}

async function recordRejection(runId: string, reason: string): Promise<void> {
  try {
    await db.stakworkRun.update({
      where: { id: runId },
      data: { reportRejectionReason: reason },
    });
  } catch {
    // Non-fatal: the run itself must not fail because we could not annotate it.
  }
}
