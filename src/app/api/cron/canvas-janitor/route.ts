import { executeScheduledCanvasJanitorRuns } from "@/services/canvas-janitor-cron";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cronEnabled = process.env.CANVAS_JANITOR_CRON_ENABLED === "true";
    if (!cronEnabled) {
      console.log("[CanvasJanitorCronAPI] Cron disabled via CANVAS_JANITOR_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Canvas janitor cron is disabled",
        orgsProcessed: 0,
        runsCreated: 0,
        skipped: 0,
        errors: [],
      });
    }

    console.log("[CanvasJanitorCronAPI] Starting scheduled canvas janitor execution");

    const result = await executeScheduledCanvasJanitorRuns();

    if (result.success) {
      console.log(
        `[CanvasJanitorCronAPI] Completed successfully. orgsProcessed=${result.orgsProcessed} runsCreated=${result.runsCreated}`,
      );
    } else {
      console.error(
        `[CanvasJanitorCronAPI] Completed with errors. orgsProcessed=${result.orgsProcessed} errors=${result.errors.length}`,
      );
    }

    return NextResponse.json({
      success: result.success,
      orgsProcessed: result.orgsProcessed,
      runsCreated: result.runsCreated,
      skipped: result.skipped,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CanvasJanitorCronAPI] Unhandled error:", errorMessage);
    return NextResponse.json(
      { success: false, error: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
