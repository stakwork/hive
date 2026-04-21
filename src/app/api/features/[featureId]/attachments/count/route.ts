import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";

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

    // Auth: x-api-token callers are trusted service-to-service clients that
    // bypass membership. Everyone else must resolve through
    // `resolveWorkspaceAccess`, which enforces workspace membership (or
    // public-viewer on `isPublicViewable` workspaces).
    const apiTokenAuth =
      request.headers.get("x-api-token") === process.env.API_TOKEN;

    if (apiTokenAuth) {
      const apiResult = await requireAuthOrApiToken(
        request,
        featureLookup.workspaceId
      );
      if (apiResult instanceof NextResponse) return apiResult;
    } else {
      const access = await resolveWorkspaceAccess(request, {
        workspaceId: featureLookup.workspaceId,
      });
      const ok = requireReadAccess(access);
      if (ok instanceof NextResponse) return ok;
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
