import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";
import { analyzeSingleSession } from "@/lib/scorer/analysis";
import { generateDigest } from "@/lib/scorer/digest";
import { cacheFeatureAgentStats } from "@/lib/scorer/agent-stats";

/**
 * POST — manually trigger single-session analysis on one feature.
 * Mirrors the automatic pipeline: digest → agent stats → analysis.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) return authResult;

  const { featureId } = await params;

  try {
    const feature = await db.feature.findUniqueOrThrow({
      where: { id: featureId },
      select: { workspaceId: true },
    });

    // Generate digest and cache agent stats first (same as auto pipeline)
    await generateDigest(featureId);
    await cacheFeatureAgentStats(featureId);

    const result = await analyzeSingleSession(featureId, feature.workspaceId);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error running analysis:", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
