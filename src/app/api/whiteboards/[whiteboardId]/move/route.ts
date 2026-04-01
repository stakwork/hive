import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { WorkspaceRole } from "@prisma/client";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const userId = userOrResponse.id;
    const { whiteboardId } = await params;
    const body = await request.json();
    const { targetWorkspaceId } = body as { targetWorkspaceId?: string };

    if (!targetWorkspaceId) {
      return NextResponse.json({ error: "targetWorkspaceId is required" }, { status: 400 });
    }

    // Fetch whiteboard with source workspace info and user's membership
    const whiteboard = await db.whiteboard.findUnique({
      where: { id: whiteboardId },
      include: {
        workspace: {
          select: {
            id: true,
            ownerId: true,
            members: {
              where: { userId, leftAt: null },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!whiteboard) {
      return NextResponse.json({ error: "Whiteboard not found" }, { status: 404 });
    }

    if (whiteboard.workspaceId === targetWorkspaceId) {
      return NextResponse.json({ error: "Whiteboard is already in that workspace" }, { status: 400 });
    }

    // Source workspace permission check: OWNER, ADMIN, or whiteboard creator
    const sourceWorkspace = whiteboard.workspace;
    const isSourceOwner = sourceWorkspace.ownerId === userId;
    const sourceMemberRole = sourceWorkspace.members[0]?.role ?? null;
    const isSourceAdmin = sourceMemberRole === WorkspaceRole.ADMIN;
    const isCreator = whiteboard.createdById === userId;

    if (!isSourceOwner && !isSourceAdmin && !isCreator) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Destination workspace write-access check
    const destWorkspace = await db.workspace.findUnique({
      where: { id: targetWorkspaceId },
      select: { id: true, slug: true, ownerId: true },
    });

    if (!destWorkspace) {
      return NextResponse.json({ error: "Destination workspace not found" }, { status: 404 });
    }

    const isDestOwner = destWorkspace.ownerId === userId;
    let destRole: WorkspaceRole | null = null;

    if (isDestOwner) {
      destRole = WorkspaceRole.OWNER;
    } else {
      const destMembership = await db.workspaceMember.findFirst({
        where: { workspaceId: targetWorkspaceId, userId, leftAt: null },
        select: { role: true },
      });
      destRole = destMembership?.role ?? null;
    }

    if (
      !destRole ||
      WORKSPACE_PERMISSION_LEVELS[destRole] < WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]
    ) {
      return NextResponse.json({ error: "Insufficient permissions in destination workspace" }, { status: 403 });
    }

    // Collect active member IDs in the destination workspace
    const destMembers = await db.workspaceMember.findMany({
      where: { workspaceId: targetWorkspaceId, leftAt: null },
      select: { userId: true },
    });
    const destMemberIds = new Set([
      destWorkspace.ownerId,
      ...destMembers.map((m) => m.userId),
    ]);

    // Find orphaned message authors (not in destination workspace)
    const orphanedMessages = await db.whiteboardMessage.findMany({
      where: {
        whiteboardId,
        userId: { not: null },
      },
      select: { userId: true },
      distinct: ["userId"],
    });

    const orphanedUserIds = orphanedMessages
      .map((m) => m.userId!)
      .filter((uid) => !destMemberIds.has(uid));

    // Execute transaction: move whiteboard, clear featureId, remap orphaned message authors
    await db.$transaction([
      db.whiteboard.update({
        where: { id: whiteboardId },
        data: { workspaceId: targetWorkspaceId, featureId: null },
      }),
      db.whiteboardMessage.updateMany({
        where: { whiteboardId, userId: { in: orphanedUserIds } },
        data: { userId },
      }),
    ]);

    return NextResponse.json({ success: true, data: { slug: destWorkspace.slug } });
  } catch (error) {
    console.error("Error moving whiteboard:", error);
    return NextResponse.json({ error: "Failed to move whiteboard" }, { status: 500 });
  }
}
