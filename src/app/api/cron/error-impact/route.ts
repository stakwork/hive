import { NextRequest, NextResponse } from "next/server";
import { runErrorImpactCron } from "@/services/error-impact-cron";

/**
 * GET /api/cron/error-impact
 *
 * Vercel cron endpoint (hourly) that scores each ErrorIssue's blast-radius
 * impact using the centrality of its referenced File/Function KG nodes.
 *
 * Auth: CRON_SECRET bearer token (same pattern as /api/cron/janitors).
 * Gate: ERROR_IMPACT_CRON_ENABLED env var must equal "true".
 */
export async function GET(request: NextRequest) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Feature gate ─────────────────────────────────────────────────────────
    const cronEnabled = process.env.ERROR_IMPACT_CRON_ENABLED === "true";
    if (!cronEnabled) {
      console.log("[error-impact] cron disabled via ERROR_IMPACT_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Error impact cron is disabled",
        workspacesProcessed: 0,
        issuesScored: 0,
        issuesSkipped: 0,
        errors: [],
      });
    }

    console.log("[error-impact] starting scheduled impact scoring run");

    const result = await runErrorImpactCron();

    if (result.success) {
      console.log(
        `[error-impact] completed. workspaces=${result.workspacesProcessed} scored=${result.issuesScored} skipped=${result.issuesSkipped}`,
      );
    } else {
      console.error(
        `[error-impact] completed with errors. workspaces=${result.workspacesProcessed} scored=${result.issuesScored} errors=${result.errors.length}`,
      );
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
