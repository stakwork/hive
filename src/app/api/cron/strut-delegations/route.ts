import { NextRequest, NextResponse } from "next/server";

import { runStrutDelegationReconcile } from "@/services/strut-delegations-cron";

// One pass touches every Bifrost-enabled workspace's strut; a renewal is a
// mint plus a PUT per member. Bounded, but not a few seconds.
export const maxDuration = 300;

/**
 * GET /api/cron/strut-delegations — daily (vercel.json).
 *
 * Keeps every user's strut standing delegation alive (re-mint + PUT inside
 * the last 15 days of its 60-day life, or when strut lost it) and removes
 * the delegations of members who left the workspace. See
 * `services/strut-delegations-cron.ts`. Kill switch:
 * `STRUT_DELEGATIONS_CRON_ENABLED=true` turns it on.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (process.env.STRUT_DELEGATIONS_CRON_ENABLED !== "true") {
      console.log("[CronAPI] Strut delegations cron is disabled via STRUT_DELEGATIONS_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Strut delegations cron is disabled",
        workspacesProcessed: 0,
        pushed: 0,
        deleted: 0,
        errors: [],
      });
    }

    // Optional `?workspace=<slug>` scopes the pass to one workspace (debugging).
    const workspaceSlug = request.nextUrl.searchParams.get("workspace") ?? undefined;

    console.log("[CronAPI] Starting strut delegation reconcile");
    const result = await runStrutDelegationReconcile({ workspaceSlug });

    if (result.success) {
      console.log(
        `[CronAPI] Strut delegation reconcile completed. Processed ${result.workspacesProcessed} workspaces, pushed ${result.pushed}, deleted ${result.deleted}`,
      );
    } else {
      console.error(
        `[CronAPI] Strut delegation reconcile completed with ${result.errors.length} errors. Processed ${result.workspacesProcessed} workspaces, pushed ${result.pushed}, deleted ${result.deleted}`,
      );
      result.errors.forEach((error, index) => {
        console.error(
          `[CronAPI] Error ${index + 1}: ${error.workspaceSlug}${error.actor ? `/${error.actor}` : ""} - ${error.error}`,
        );
      });
    }

    return NextResponse.json({
      success: result.success,
      workspacesProcessed: result.workspacesProcessed,
      workspacesSkipped: result.workspacesSkipped,
      pushed: result.pushed,
      deleted: result.deleted,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: result.timestamp.toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CronAPI] Unhandled error:", errorMessage);
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
