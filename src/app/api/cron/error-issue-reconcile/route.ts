import { NextRequest, NextResponse } from "next/server";
import { runErrorIssueReconcileCron } from "@/services/error-issue-reconcile-cron";

/**
 * GET /api/cron/error-issue-reconcile
 *
 * Vercel cron endpoint (hourly) that resolves stuck UNRESOLVED ErrorIssues
 * whose Feature's Task already has a merged PULL_REQUEST artifact (status='DONE')
 * but whose ErrorIssue was never resolved — typically because the merge webhook
 * fired before the artifact row was committed.
 *
 * Auth: CRON_SECRET bearer token (same pattern as /api/cron/error-impact).
 * Gate: ERROR_ISSUE_RECONCILE_CRON_ENABLED env var must equal "true".
 */
export async function GET(request: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Feature gate ─────────────────────────────────────────────────────────
    const cronEnabled = process.env.ERROR_ISSUE_RECONCILE_CRON_ENABLED === "true";
    if (!cronEnabled) {
      console.log("[error-issue-reconcile] cron disabled via ERROR_ISSUE_RECONCILE_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Error issue reconcile cron is disabled",
        issuesScanned: 0,
        issuesResolved: 0,
        errors: [],
      });
    }

    console.log("[error-issue-reconcile] starting scheduled reconciliation run");

    const result = await runErrorIssueReconcileCron();

    if (result.success) {
      console.log(
        `[error-issue-reconcile] completed. scanned=${result.issuesScanned} resolved=${result.issuesResolved}`,
      );
    } else {
      console.error(
        `[error-issue-reconcile] completed with errors. scanned=${result.issuesScanned} resolved=${result.issuesResolved} errors=${result.errors.length}`,
      );
    }

    return NextResponse.json({
      success: result.success,
      issuesScanned: result.issuesScanned,
      issuesResolved: result.issuesResolved,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: result.timestamp.toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[error-issue-reconcile] unhandled error:", errorMessage);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
