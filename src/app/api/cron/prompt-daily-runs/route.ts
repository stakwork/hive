import { syncPromptDailyRuns } from "@/services/prompts/prompt-daily-runs-sync";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/prompt-daily-runs
 *
 * Vercel cron job — runs at 02:00 UTC daily.
 * Pulls yesterday's prompt run counts from Stakwork and upserts them locally.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[PromptDailyRunsCron] Starting scheduled execution");

    const result = await syncPromptDailyRuns();

    console.log(
      `[PromptDailyRunsCron] Completed. Pulled=${result.pulled} ` +
        `Upserted=${result.upserted} Skipped=${result.skipped} Errors=${result.errors}`,
    );

    return NextResponse.json({
      success: result.errors === 0,
      targetDate: result.targetDate,
      pulled: result.pulled,
      upserted: result.upserted,
      skipped: result.skipped,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[PromptDailyRunsCron] Unhandled error:", errorMessage);

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
