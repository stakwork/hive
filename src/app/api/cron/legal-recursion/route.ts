import { NextRequest, NextResponse } from "next/server";
import { executeScheduledLegalBenchmarkRecursion } from "@/services/legal-recursion-cron";

/**
 * GET /api/cron/legal-recursion
 * Vercel cron: re-runs recursion-flagged Legal Benchmark eval tasks.
 * Schedule: "0 *\/6 * * *" (every 6 hours — already wired in vercel.json)
 *
 * Protected by CRON_SECRET bearer token (same pattern as prompt-usage-sync
 * and error-impact cron routes — no new secret required).
 */
export async function GET(request: NextRequest) {
  // Verify Vercel cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await executeScheduledLegalBenchmarkRecursion();

    return NextResponse.json({
      success: result.success,
      entriesProcessed: result.entriesProcessed,
      dispatched: result.dispatched,
      skipped: result.skipped,
      deactivated: result.deactivated,
      attemptCapped: result.attemptCapped,
      plateauCapped: result.plateauCapped,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: result.timestamp.toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[CronAPI] Unhandled error in legal recursion cron:", errorMessage);

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
