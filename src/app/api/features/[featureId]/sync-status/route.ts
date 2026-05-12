import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateFeatureAccess } from "@/services/roadmap/utils";
import { updateFeatureStatusFromTasks } from "@/services/roadmap/feature-status-sync";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;

    logger.info(
      `[feature-status-sync] Manual sync triggered for feature ${featureId} by user ${userOrResponse.id}`
    );

    await validateFeatureAccess(featureId, userOrResponse.id);

    await updateFeatureStatusFromTasks(featureId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync feature status";

    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("denied")) {
      return NextResponse.json({ error: message }, { status: 403 });
    }

    logger.error("[feature-status-sync] Unexpected error:", undefined, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
