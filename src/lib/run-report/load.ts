/**
 * Load a run report for viewing.
 *
 * The bundle JSON stays in S3. This fetches it, sanitizes it and projects it on
 * demand — nothing is copied into the database except the URL itself. Shared by
 * the API route and the RSC page so both apply the identical pipeline.
 *
 * Never throws: every failure becomes a payload the renderer can display.
 */

import { fetchReportBundle, BundleFetchError } from "./fetch-bundle";
import { projectBundle } from "./project";
import { safeUrlParts } from "./safe-url-log";
import { logger } from "@/lib/logger";
import type { RunReportPayload } from "./types";

const LOG_SERVICE = "run-report/load";

export async function loadRunReport(
  runId: string,
  reportUrl: string | null,
): Promise<RunReportPayload> {
  if (!reportUrl) {
    return { runId, hasReport: false, projection: null };
  }

  const { host, pathHash } = safeUrlParts(reportUrl);

  try {
    const { text } = await fetchReportBundle(reportUrl);
    const outcome = projectBundle(text);

    if (outcome.status === "unparseable") {
      logger.error("[run-report] Bundle unparseable", LOG_SERVICE, { runId, host, pathHash });
      return { runId, hasReport: true, error: "unavailable", projection: null };
    }

    return { runId, hasReport: true, projection: outcome.projection };
  } catch (err) {
    // BundleFetchError carries a reason code — distinguish url_rejected (a guard
    // decision that needs operator attention) from transient fetch failures.
    const isUrlRejected =
      err instanceof BundleFetchError && err.reason === "url_rejected";

    logger.error("[run-report] Bundle load failed", LOG_SERVICE, {
      runId,
      host,
      pathHash,
      reason: err instanceof Error ? err.message : "unknown",
    });
    return {
      runId,
      hasReport: true,
      error: isUrlRejected ? "url_rejected" : "unavailable",
      projection: null,
    };
  }
}
