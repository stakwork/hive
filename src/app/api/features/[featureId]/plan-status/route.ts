import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateFeatureAccess } from "@/services/roadmap/utils";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;

    await validateFeatureAccess(featureId, userOrResponse.id);

    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workflowStatus: true, stakworkProjectId: true },
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        workflowStatus: feature.workflowStatus,
        hasLogs: !!feature.stakworkProjectId,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch feature plan status";

    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("denied")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    logger.error("[plan-status] Unexpected error:", undefined, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
