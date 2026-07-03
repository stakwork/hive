import { executeScheduledActivityRecapRuns } from "@/services/daily-recap-cron";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/daily-recap
 *
 * Vercel cron job — runs at 09:00 UTC daily.
 * Fans out one Stakwork daily-recap workflow per opted-in active user.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!process.env.STAKWORK_DAILY_RECAP_WORKFLOW_ID) {
      console.log("[ActivityRecapCron] STAKWORK_DAILY_RECAP_WORKFLOW_ID not configured, skipping");
      return NextResponse.json({ success: true, message: "Daily recap cron not configured" });
    }

    console.log("[ActivityRecapCron] Starting scheduled execution");

    const result = await executeScheduledActivityRecapRuns();

    console.log(
      `[ActivityRecapCron] Completed. Processed=${result.usersProcessed} ` +
        `Dispatched=${result.dispatched} Skipped=${result.skipped} Errors=${result.errors.length}`,
    );

    return NextResponse.json({
      success: result.errors.length === 0,
      usersProcessed: result.usersProcessed,
      dispatched: result.dispatched,
      skipped: result.skipped,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[ActivityRecapCron] Unhandled error:", errorMessage);

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
