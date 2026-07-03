import { runErrorImpactCron } from "@/services/error-impact-cron";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/error-impact
 *
 * Hourly Vercel cron that (re)computes blast-radius impact scores for
 * ErrorIssue rows whose referenced KG nodes have centrality data in Jarvis.
 *
 * Auth: CRON_SECRET bearer token (same pattern as /api/cron/janitors).
 * Gate: ERROR_IMPACT_CRON_ENABLED=true env var must be set.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify Vercel cron secret
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if cron is enabled
    const cronEnabled = process.env.ERROR_IMPACT_CRON_ENABLED === "true";
    if (!cronEnabled) {
      console.log("[error-impact] cron is disabled via ERROR_IMPACT_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Error impact cron is disabled",
        workspacesProcessed: 0,
        issuesScored: 0,
        issuesSkipped: 0,
        errors: [],
      });
    }

    console.log("[error-impact] starting scheduled cron execution");

    const result = await runErrorImpactCron();

    if (result.success) {
      console.log(
        `[error-impact] completed successfully — workspaces: ${result.workspacesProcessed}, scored: ${result.issuesScored}, skipped: ${result.issuesSkipped}`,
      );
    } else {
      console.error(
        `[error-impact] completed with errors — workspaces: ${result.workspacesProcessed}, scored: ${result.issuesScored}, errors: ${result.errors.length}`,
      );
      result.errors.forEach((e, i) => {
        console.error(`[error-impact] error ${i + 1}: workspace=${e.workspaceId} issue=${e.issueId} — ${e.error}`);
      });
    }

    return NextResponse.json({
      success: result.success,
      workspacesProcessed: result.workspacesProcessed,
      issuesScored: result.issuesScored,
      issuesSkipped: result.issuesSkipped,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: result.timestamp.toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[error-impact] unhandled error:", errorMessage);

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
