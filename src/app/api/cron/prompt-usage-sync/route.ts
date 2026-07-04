import { executeScheduledPromptUsageSync } from "@/services/prompts/prompt-usage-sync";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/prompt-usage-sync
 * Vercel cron: pulls Stakwork prompt_usages and upserts/prunes the local mirror.
 * Schedule: "0 * * * *" (hourly)
 */
export async function GET(request: NextRequest) {
  try {
    // Verify Vercel cron secret
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if cron is enabled
    const cronEnabled = process.env.PROMPT_USAGE_SYNC_CRON_ENABLED === "true";
    if (!cronEnabled) {
      console.log("[CronAPI] Prompt usage sync cron is disabled via PROMPT_USAGE_SYNC_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Prompt usage sync cron is disabled",
        workspacesProcessed: 0,
        usagesUpserted: 0,
        usagesPruned: 0,
        errors: [],
      });
    }

    console.log("[CronAPI] Starting scheduled prompt usage sync");

    const result = await executeScheduledPromptUsageSync();

    if (result.success) {
      console.log(
        `[CronAPI] Prompt usage sync completed successfully. Processed ${result.workspacesProcessed} workspaces, upserted ${result.usagesUpserted}, pruned ${result.usagesPruned}`,
      );
    } else {
      console.error(
        `[CronAPI] Prompt usage sync completed with errors. Processed ${result.workspacesProcessed} workspaces, ${result.errors.length} errors`,
      );
      result.errors.forEach((error, index) => {
        console.error(`[CronAPI] Error ${index + 1}: ${error.workspaceSlug} - ${error.error}`);
      });
    }

    return NextResponse.json({
      success: result.success,
      workspacesProcessed: result.workspacesProcessed,
      usagesUpserted: result.usagesUpserted,
      usagesPruned: result.usagesPruned,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: result.timestamp.toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CronAPI] Unhandled error in prompt usage sync:", errorMessage);

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
