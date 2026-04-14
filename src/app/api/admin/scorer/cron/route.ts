import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { runPatternDetectionCron } from "@/lib/scorer/pipeline";

/**
 * POST — manually trigger the pattern detection cron job.
 * In production, this would be called by a scheduler (e.g. Vercel Cron).
 */
export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  try {
    await runPatternDetectionCron();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error running scorer cron:", error);
    return NextResponse.json(
      { error: "Failed to run pattern detection cron" },
      { status: 500 }
    );
  }
}
