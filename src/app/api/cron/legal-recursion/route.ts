import { executeScheduledLegalBenchmarkRecursion } from "@/services/legal-recursion-cron";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET endpoint for Vercel cron execution of the OpenLaw Recursion Janitor.
 * Vercel cron jobs trigger GET requests, not POST.
 *
 * Requires:
 *   - Authorization: Bearer <CRON_SECRET>
 *
 * Enable/disable via the legalBenchmarkRecursionEnabled toggle in JanitorConfig
 * (OpenLaw workspace Janitors page or superadmin panel).
 */
export async function GET(request: NextRequest) {
  try {
    // Verify Vercel cron secret
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log("[LegalRecursionCronAPI] Starting scheduled legal benchmark recursion");

    const result = await executeScheduledLegalBenchmarkRecursion();

    if (result.success) {
      console.log(
        `[LegalRecursionCronAPI] Completed successfully. Processed ${result.entriesProcessed} entries, dispatched ${result.dispatched}, deactivated ${result.deactivated}`,
      );
    } else {
      console.error(
        `[LegalRecursionCronAPI] Completed with errors. Processed ${result.entriesProcessed} entries, ${result.errors.length} errors`,
      );
    }

    return NextResponse.json({
      success: result.success,
      entriesProcessed: result.entriesProcessed,
      dispatched: result.dispatched,
      skipped: result.skipped,
      deactivated: result.deactivated,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: result.timestamp.toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[LegalRecursionCronAPI] Unhandled error:", errorMessage);

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
