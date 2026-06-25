import { executeScheduledDailyRecapRuns } from "@/services/daily-recap-cron";
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

    const cronEnabled = process.env.DAILY_RECAP_CRON_ENABLED === "true";
    if (!cronEnabled) {
      console.log("[DailyRecapCron] Cron disabled via DAILY_RECAP_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Daily recap cron is disabled",
        usersProcessed: 0,
        dispatched: 0,
        skipped: 0,
        errorCount: 0,
        errors: [],
        timestamp: new Date().toISOString(),
      });
    }

    console.log("[DailyRecapCron] Starting scheduled execution");

    const result = await executeScheduledDailyRecapRuns();

    console.log(
      `[DailyRecapCron] Completed. Processed=${result.usersProcessed} ` +
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
    console.error("[DailyRecapCron] Unhandled error:", errorMessage);

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
