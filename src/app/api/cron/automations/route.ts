import { dispatchDueAutomations } from "@/services/automation-dispatcher";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/automations
 *
 * Vercel cron endpoint (runs every minute) that picks up enabled
 * `Automation` records whose `nextRunAt` has passed, creates a fresh
 * org-canvas conversation, runs the canvas agent with the automation's
 * prompt, and re-arms the schedule for the next day.
 *
 * Gated by:
 *   - `CRON_SECRET` Authorization header (standard cron guard)
 *   - `AUTOMATIONS_ENABLED=true` environment flag
 */
export async function GET(request: NextRequest) {
  try {
    console.log("[Automations] Cron endpoint hit");
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      console.warn(
        "[Automations] Unauthorized — missing/incorrect CRON_SECRET bearer",
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (process.env.AUTOMATIONS_ENABLED !== "true") {
      console.log(
        "[Automations] Disabled via AUTOMATIONS_ENABLED (set it to \"true\" to enable)",
      );
      return NextResponse.json({
        success: true,
        message: "Disabled",
        fired: 0,
        failed: 0,
        errors: [],
      });
    }

    const result = await dispatchDueAutomations();

    return NextResponse.json({
      success: result.failed === 0,
      fired: result.fired,
      failed: result.failed,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Automations] Unhandled error:", errorMessage);

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
