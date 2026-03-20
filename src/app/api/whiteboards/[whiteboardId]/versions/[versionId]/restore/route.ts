import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

const MAX_VERSIONS = 10;

async function checkWhiteboardAccess(whiteboardId: string, userId: string) {
  const whiteboard = await db.whiteboards.findUnique({
    where: { id: whiteboardId },
    include: {
      workspace: {
        select: {
          ownerId: true,
          members: {
            where: { userId },
            select: { role: true },
          },
        },
      },
    },
  });

  if (!whiteboard) return null;

  const isOwner = whiteboard.workspace.ownerId === userId;
  const isMember = whiteboard.workspace.members.length > 0;

  if (!isOwner && !isMember) return "forbidden" as const;

  return whiteboard;
}

async function createVersionSnapshot(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  whiteboardId: string,
  elements: unknown,
  appState: unknown,
  files: unknown,
  label: string
) {
  const created = await tx.whiteboard_versions.create({
    data: {
      whiteboardId,
      elements: (elements as object) ?? [],
      appState: (appState as object) ?? {},
      files: (files as object) ?? {},
      label,
    },
  });

  const allVersions = await tx.whiteboard_versions.findMany({
    where: { whiteboardId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (allVersions.length > MAX_VERSIONS) {
    const toDelete = allVersions.slice(0, allVersions.length - MAX_VERSIONS);
    await tx.whiteboard_versions.deleteMany({
      where: { id: { in: toDelete.map((v) => v.id) } },
    });
  }

  return created;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string; versionId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { whiteboardId, versionId } = await params;

    const whiteboard = await checkWhiteboardAccess(whiteboardId, userOrResponse.id);
    if (!whiteboard) {
      return NextResponse.json({ error: "Whiteboard not found" }, { status: 404 });
    }
    if (whiteboard === "forbidden") {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const targetVersion = await db.whiteboard_versions.findUnique({
      where: { id: versionId },
    });

    if (!targetVersion || targetVersion.whiteboardId !== whiteboardId) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const updatedWhiteboard = await db.$transaction(async (tx) => {
      // Snapshot current state before overwriting so user can undo
      const restoreLabel = `Before restore · ${new Date().toLocaleString()}`;
      await createVersionSnapshot(
        tx,
        whiteboardId,
        whiteboard.elements,
        whiteboard.appState,
        whiteboard.files,
        restoreLabel
      );

      // Apply the selected version
      return tx.whiteboards.update({
        where: { id: whiteboardId },
        data: {
          elements: targetVersion.elements as object,
          appState: targetVersion.appState as object,
          files: targetVersion.files as object,
          version: { increment: 1 },
        },
      });
    });

    return NextResponse.json({ success: true, data: updatedWhiteboard });
  } catch (error) {
    console.error("Error restoring whiteboard version:", error);
    return NextResponse.json({ error: "Failed to restore version" }, { status: 500 });
  }
}
