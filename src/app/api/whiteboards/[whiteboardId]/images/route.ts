import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { getS3Service } from "@/services/s3";

async function getWhiteboardWithAccess(whiteboardId: string, userId: string) {
  const whiteboard = await db.whiteboards.findUnique({
    where: { id: whiteboardId },
    include: {
      workspace: {
        select: {
          id: true,
          ownerId: true,
          members: {
            where: { userId },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!whiteboard) return { whiteboard: null, error: "Whiteboard not found", status: 404 };

  const isOwner = whiteboard.workspace.ownerId === userId;
  const isMember = whiteboard.workspace.members.length > 0;

  if (!isOwner && !isMember) return { whiteboard: null, error: "Access denied", status: 403 };

  return { whiteboard, error: null, status: 200 };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { whiteboardId } = await params;
    const { whiteboard, error, status } = await getWhiteboardWithAccess(whiteboardId, userOrResponse.id);

    if (!whiteboard) {
      return NextResponse.json({ error }, { status });
    }

    const body = await request.json();
    const { fileId, mimeType } = body as { fileId: string; mimeType: string };

    if (!fileId || !mimeType) {
      return NextResponse.json({ error: "fileId and mimeType are required" }, { status: 400 });
    }

    const s3Service = getS3Service();
    const s3Key = s3Service.generateWhiteboardImagePath(
      whiteboard.workspace.id,
      whiteboardId,
      fileId,
      mimeType
    );
    const presignedUploadUrl = await s3Service.generatePresignedUploadUrl(s3Key, mimeType, 300);

    return NextResponse.json({ presignedUploadUrl, s3Key });
  } catch (error) {
    console.error("Error generating whiteboard image upload URL:", error);
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { whiteboardId } = await params;
    const { whiteboard, error, status } = await getWhiteboardWithAccess(whiteboardId, userOrResponse.id);

    if (!whiteboard) {
      return NextResponse.json({ error }, { status });
    }

    const { searchParams } = new URL(request.url);
    const fileIdsParam = searchParams.get("fileIds");

    if (!fileIdsParam) {
      return NextResponse.json({ error: "fileIds query param is required" }, { status: 400 });
    }

    const requestedIds = fileIdsParam.split(",").filter(Boolean);
    const storedFiles = (whiteboard.files as Record<string, unknown>) || {};
    const s3Service = getS3Service();

    const result: Record<string, { presignedDownloadUrl: string; mimeType: string }> = {};

    await Promise.all(
      requestedIds.map(async (fileId) => {
        const entry = storedFiles[fileId] as Record<string, unknown> | undefined;
        if (!entry || !entry.s3Key) return; // skip legacy base64 or missing entries

        try {
          const presignedDownloadUrl = await s3Service.generatePresignedDownloadUrl(
            entry.s3Key as string,
            3600
          );
          result[fileId] = { presignedDownloadUrl, mimeType: entry.mimeType as string };
        } catch {
          // S3 key missing/deleted — skip gracefully, canvas will show broken image
        }
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error generating whiteboard image download URLs:", error);
    return NextResponse.json({ error: "Failed to generate download URLs" }, { status: 500 });
  }
}
