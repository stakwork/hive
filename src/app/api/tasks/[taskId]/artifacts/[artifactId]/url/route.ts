/**
 * Artifact Fresh URL Generation Endpoint
 *
 * Generates fresh presigned URLs for artifact media (videos, images, etc.)
 * This ensures media remains accessible even after initial presigned URLs expire.
 *
 * Why this is needed:
 * - Vercel's OIDC credentials are temporary (~1 hour)
 * - Presigned URLs cannot outlive the IAM credentials that created them
 * - By generating URLs on-demand, we ensure videos are always playable
 *
 * Usage:
 * GET /api/tasks/[taskId]/artifacts/[artifactId]/url
 *
 * Response:
 * {
 *   "url": "https://s3.../fresh-presigned-url",
 *   "expiresIn": 3600
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { getS3Service } from "@/services/s3";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { ArtifactType } from "@prisma/client";
import { MediaContent } from "@/lib/chat";

export const fetchCache = "force-no-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ taskId: string; artifactId: string }> }
) {
  try {
    const { taskId, artifactId } = await params;

    if (!taskId || !artifactId) {
      return NextResponse.json({ error: "Task ID and Artifact ID required" }, { status: 400 });
    }

    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch artifact with task relations
    const artifact = await db.artifact.findUnique({
      where: { id: artifactId },
      include: {
        message: {
          include: {
            task: {
              select: {
                id: true,
                workspaceId: true,
              },
            },
          },
        },
      },
    });

    if (!artifact) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }

    // Validate artifact belongs to the specified task
    if (artifact.message?.task?.id !== taskId) {
      return NextResponse.json({ error: "Artifact does not belong to this task" }, { status: 400 });
    }

    // Validate artifact is a media type with S3 content
    if (artifact.type !== ArtifactType.MEDIA) {
      return NextResponse.json({ error: "Artifact is not a media type" }, { status: 400 });
    }

    // Validate user has access to the workspace
    const workspaceId = artifact.message?.task?.workspaceId;
    if (!workspaceId) {
      return NextResponse.json({ error: "Artifact not associated with a workspace" }, { status: 404 });
    }

    const accessValidation = await validateWorkspaceAccessById(workspaceId, session.user.id);
    if (!accessValidation.hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Extract S3 key from artifact content
    const content = artifact.content as unknown as MediaContent;
    const s3Key = content?.s3Key;

    if (!s3Key) {
      return NextResponse.json(
        { error: "Artifact does not have an S3 key" },
        { status: 400 }
      );
    }

    // Generate fresh presigned URL (1 hour expiration)
    const s3Service = getS3Service();
    const expiresIn = 3600; // 1 hour
    const presignedUrl = await s3Service.generatePresignedDownloadUrl(s3Key, expiresIn);

    return NextResponse.json({
      url: presignedUrl,
      expiresIn,
    });
  } catch (error) {
    console.error("Error generating artifact URL:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
