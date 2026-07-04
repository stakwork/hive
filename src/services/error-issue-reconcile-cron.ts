/**
 * Error Issue Reconciliation Cron Service
 *
 * Sweeps for UNRESOLVED ErrorIssues that are stuck because the merge webhook
 * fired before the PULL_REQUEST artifact row was committed. These issues have
 * a Feature whose Task already has a PULL_REQUEST artifact marked as merged
 * (content->>'status' = 'DONE'), but the linked ErrorIssue was never resolved.
 *
 * The existing pr-monitor cron skips artifacts with status DONE/CANCELLED, so
 * this sweep is the only backstop for that class of stuck issues.
 *
 * Best-effort and non-blocking:
 *  - Each feature is wrapped in its own try/catch so one failure never aborts
 *    the batch.
 *  - Never throws from the top-level export — callers always get a summary.
 */

import { db } from "@/lib/db";
import { autoResolveErrorIssuesForFeatures } from "@/services/error-issues";

const LOG_PREFIX = "[error-issue-reconcile]";

/** Max feature batches to process per cron run (avoid runaway queries). */
const MAX_FEATURES_PER_RUN = 100;

export interface ErrorIssueReconcileCronResult {
  success: boolean;
  issuesScanned: number;
  issuesResolved: number;
  errors: Array<{ featureId: string; error: string }>;
  timestamp: Date;
}

/**
 * Run the ErrorIssue reconciliation pass.
 * Finds UNRESOLVED ErrorIssues whose linked Feature has a Task with a
 * PULL_REQUEST artifact already marked merged (content.status = 'DONE'),
 * and resolves them via the shared autoResolveErrorIssuesForFeatures service.
 *
 * Never throws — always returns a summary result.
 */
export async function runErrorIssueReconcileCron(): Promise<ErrorIssueReconcileCronResult> {
  const timestamp = new Date();
  const result: ErrorIssueReconcileCronResult = {
    success: true,
    issuesScanned: 0,
    issuesResolved: 0,
    errors: [],
    timestamp,
  };

  console.info(`${LOG_PREFIX} cron starting`, { timestamp: timestamp.toISOString() });

  // Find distinct featureIds that have:
  //   - At least one UNRESOLVED ErrorIssue linked via Feature.errorIssueId
  //   - At least one Task with a PULL_REQUEST artifact where content->>'status' = 'DONE'
  //
  // Raw SQL mirrors the join shape used in the webhook route and pr-monitor
  // (artifacts → chat_messages → tasks → features → error_issues).
  let rows: Array<{ feature_id: string; unresolved_count: bigint }>;
  try {
    rows = await db.$queryRaw<Array<{ feature_id: string; unresolved_count: bigint }>>`
      SELECT
        f.id AS feature_id,
        COUNT(DISTINCT ei.id) AS unresolved_count
      FROM features f
      INNER JOIN error_issues ei
        ON ei.id = f.error_issue_id
        AND ei.status = 'UNRESOLVED'
      INNER JOIN tasks t
        ON t.feature_id = f.id
        AND t.deleted = false
        AND t.archived = false
      INNER JOIN chat_messages m
        ON m.task_id = t.id
      INNER JOIN artifacts a
        ON a.message_id = m.id
        AND a.type = 'PULL_REQUEST'
        AND a.content->>'status' = 'DONE'
      GROUP BY f.id
      LIMIT ${MAX_FEATURES_PER_RUN}
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} failed to query stuck issues (aborting cron)`, { error: msg });
    result.success = false;
    result.errors.push({ featureId: "global", error: msg });
    return result;
  }

  if (rows.length === 0) {
    console.info(`${LOG_PREFIX} no stuck UNRESOLVED issues found`);
    return result;
  }

  // Count total issues scanned across all features
  result.issuesScanned = rows.reduce((sum, r) => sum + Number(r.unresolved_count), 0);

  console.info(`${LOG_PREFIX} found ${rows.length} feature(s) with stuck UNRESOLVED issue(s)`, {
    issuesScanned: result.issuesScanned,
  });

  for (const row of rows) {
    try {
      const { resolvedIssueIds } = await autoResolveErrorIssuesForFeatures([row.feature_id]);
      result.issuesResolved += resolvedIssueIds.length;

      if (resolvedIssueIds.length > 0) {
        console.info(`${LOG_PREFIX} resolved issue(s) for feature`, {
          featureId: row.feature_id,
          resolvedCount: resolvedIssueIds.length,
          resolvedIssueIds,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG_PREFIX} failed to resolve issues for feature (skipping)`, {
        featureId: row.feature_id,
        error: msg,
      });
      result.success = false;
      result.errors.push({ featureId: row.feature_id, error: msg });
    }
  }

  console.info(`${LOG_PREFIX} cron complete`, {
    issuesScanned: result.issuesScanned,
    issuesResolved: result.issuesResolved,
    errorCount: result.errors.length,
  });

  return result;
}
