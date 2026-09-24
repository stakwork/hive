import { NextRequest, NextResponse } from "next/server";

import { getBaseUrl } from "@/lib/utils";
import { runStrutHiveKeyReconcile } from "@/services/strut-hive-key";

// One GET /secrets per embedded strut, plus a mint + two PUTs on rotation.
export const maxDuration = 300;

/**
 * GET /api/cron/strut-hive-keys — daily (vercel.json).
 *
 * Keeps every embedded strut's `HIVE_API_KEY` / `HIVE_URL` deployment
 * secrets in place: rotates the org key when strut lost it or the key on
 * record is no longer live, re-pushes a missing `HIVE_URL`. See
 * `services/strut-hive-key.ts`. Kill switch:
 * `STRUT_HIVE_KEYS_CRON_ENABLED=true` turns it on.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (process.env.STRUT_HIVE_KEYS_CRON_ENABLED !== "true") {
      console.log("[CronAPI] Strut hive keys cron is disabled via STRUT_HIVE_KEYS_CRON_ENABLED");
      return NextResponse.json({
        success: true,
        message: "Strut hive keys cron is disabled",
        swarmsProcessed: 0,
        rotated: 0,
        revoked: 0,
        errors: [],
      });
    }

    // Optional `?workspace=<slug>` scopes the pass to one workspace (debugging).
    const workspaceSlug = request.nextUrl.searchParams.get("workspace") ?? undefined;

    // HIVE_URL is a standing value: the canonical URL, not whichever host the cron hit.
    const result = await runStrutHiveKeyReconcile({ publicBaseUrl: getBaseUrl(), workspaceSlug });

    if (!result.success) {
      result.errors.forEach((error, index) => {
        console.error(`[CronAPI] Strut hive key error ${index + 1}: ${error.workspaceSlug} - ${error.error}`);
      });
    }

    return NextResponse.json({
      success: result.success,
      swarmsProcessed: result.swarmsProcessed,
      swarmsSkipped: result.swarmsSkipped,
      rotated: result.rotated,
      revoked: result.revoked,
      errorCount: result.errors.length,
      errors: result.errors,
      timestamp: result.timestamp.toISOString(),
    });
  } catch (error) {
    console.error("[CronAPI] Unhandled error:", error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { success: false, error: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
