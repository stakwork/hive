import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";

/**
 * GET /api/features/[featureId]/attachments/count
 *
 * Returns the count of image attachments for tasks associated with a feature.
 * Used by the Verify tab to determine if it should be enabled.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ featureId: string }> }
) {
  try {
    const { featureId } = await context.params;

    // Look up feature to get workspaceId for auth
    const featureLookup = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });

    if (!featureLookup) {
      return NextResponse.json({ error: "Feature not found" }, { status: 404 });
    }

    // Authenticate user or API token
    const userOrResponse = await requireAuthOrApiToken(
      request,
      featureLookup.workspaceId
    );

    if (userOrResponse instanceof NextResponse) {
      return userOrResponse;
    }

    const count = await db.attachment.count({
      where: {
        mimeType: { startsWith: "image/" },
        message: {
          taskId: { not: null },
          task: { featureId, deleted: false },
        },
      },
    });

    return NextResponse.json({ count });
  } catch (error) {
    console.error("Error counting feature attachments:", error);
    return NextResponse.json(
      { error: "Failed to count attachments" },
      { status: 500 }
    );
  }
}
