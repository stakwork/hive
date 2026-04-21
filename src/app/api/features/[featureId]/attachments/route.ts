import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { getS3Service } from "@/services/s3";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";

/**
 * GET /api/features/[featureId]/attachments
 * 
 * Fetches all image attachments for tasks associated with a feature.
 * Used by the Verify tab to display agent-produced screenshots.
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
      return NextResponse.json(
        { error: "Feature not found" },
        { status: 404 }
      );
    }

    // Auth: x-api-token callers are trusted service-to-service clients that
    // bypass membership. Everyone else must resolve through
    // `resolveWorkspaceAccess`, which enforces workspace membership (or
    // public-viewer on `isPublicViewable` workspaces). Without this,
    // `requireAuthOrApiToken` would accept any signed-in user and return
    // 7-day presigned S3 URLs for any feature's task attachments.
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

    // Fetch all image attachments for tasks in this feature
    // Single query with nested where filters (no N+1)
    const attachments = await db.attachment.findMany({
      where: {
        mimeType: { startsWith: "image/" },
        message: {
          taskId: { not: null },
          task: {
            featureId,
            deleted: false,
          },
        },
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        path: true,
        createdAt: true,
        message: {
          select: {
            taskId: true,
            task: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Generate presigned S3 URLs (7-day TTL)
    const s3Service = getS3Service();
    const sevenDays = 7 * 24 * 60 * 60; // seconds

    const attachmentsWithUrls = await Promise.all(
      attachments.map(async (attachment) => {
        const url = await s3Service.generatePresignedDownloadUrl(
          attachment.path,
          sevenDays
        );

        return {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          url,
          taskId: attachment.message.taskId,
          taskTitle: attachment.message.task?.title || "Untitled Task",
          createdAt: attachment.createdAt,
        };
      })
    );

    return NextResponse.json({
      attachments: attachmentsWithUrls,
    });
  } catch (error) {
    console.error("Error fetching feature attachments:", error);
    return NextResponse.json(
      { error: "Failed to fetch attachments" },
      { status: 500 }
    );
  }
}
