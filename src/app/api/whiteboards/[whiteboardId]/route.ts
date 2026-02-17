import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { pusherServer, getWhiteboardChannelName, PUSHER_EVENTS } from "@/lib/pusher";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { whiteboardId } = await params;

    const whiteboard = await db.whiteboard.findUnique({
      where: { id: whiteboardId },
      include: {
        workspace: {
          select: {
            id: true,
            ownerId: true,
            members: {
              where: { userId: userOrResponse.id },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!whiteboard) {
      return NextResponse.json({ error: "Whiteboard not found" }, { status: 404 });
    }

    // Check access
    const isOwner = whiteboard.workspace.ownerId === userOrResponse.id;
    const isMember = whiteboard.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: whiteboard.id,
        name: whiteboard.name,
        featureId: whiteboard.featureId,
        elements: whiteboard.elements,
        appState: whiteboard.appState,
        files: whiteboard.files,
        version: whiteboard.version,
        createdAt: whiteboard.createdAt,
        updatedAt: whiteboard.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching whiteboard:", error);
    return NextResponse.json({ error: "Failed to fetch whiteboard" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { whiteboardId } = await params;
    const body = await request.json();

    const whiteboard = await db.whiteboard.findUnique({
      where: { id: whiteboardId },
      include: {
        workspace: {
          select: {
            ownerId: true,
            members: {
              where: { userId: userOrResponse.id },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!whiteboard) {
      return NextResponse.json({ error: "Whiteboard not found" }, { status: 404 });
    }

    // Check access
    const isOwner = whiteboard.workspace.ownerId === userOrResponse.id;
    const isMember = whiteboard.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Block element saves while diagram generation is active
    if (body.elements !== undefined && whiteboard.featureId) {
      const activeGeneration = await db.stakworkRun.findFirst({
        where: {
          featureId: whiteboard.featureId,
          type: "DIAGRAM_GENERATION",
          status: { in: ["PENDING", "IN_PROGRESS"] },
        },
        select: { id: true },
      });
      if (activeGeneration) {
        return NextResponse.json(
          { error: "Diagram generation in progress", generating: true },
          { status: 409 }
        );
      }
    }

    // Handle featureId linking/unlinking (null to unlink)
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.elements !== undefined) updateData.elements = body.elements;
    if (body.appState !== undefined) updateData.appState = body.appState;
    if (body.files !== undefined) updateData.files = body.files;
    if ("featureId" in body) updateData.featureId = body.featureId;

    // Increment version if elements are being updated (for conflict resolution)
    const shouldIncrementVersion = body.elements !== undefined;
    if (shouldIncrementVersion) {
      updateData.version = { increment: 1 };
    }

    const updated = await db.whiteboard.update({
      where: { id: whiteboardId },
      data: updateData,
      include: {
        feature: {
          select: { id: true, title: true },
        },
      },
    });

    // Broadcast changes if requested and elements were updated
    if (body.broadcast && body.elements !== undefined && body.senderId) {
      const channelName = getWhiteboardChannelName(whiteboardId);
      await pusherServer.trigger(channelName, PUSHER_EVENTS.WHITEBOARD_ELEMENTS_UPDATE, {
        senderId: body.senderId,
        elements: body.elements,
        appState: body.appState || {},
        version: updated.version,
      });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating whiteboard:", error);
    return NextResponse.json({ error: "Failed to update whiteboard" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { whiteboardId } = await params;

    const whiteboard = await db.whiteboard.findUnique({
      where: { id: whiteboardId },
      include: {
        workspace: {
          select: {
            ownerId: true,
            members: {
              where: { userId: userOrResponse.id },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!whiteboard) {
      return NextResponse.json({ error: "Whiteboard not found" }, { status: 404 });
    }

    // Check access
    const isOwner = whiteboard.workspace.ownerId === userOrResponse.id;
    const isMember = whiteboard.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    await db.whiteboard.delete({ where: { id: whiteboardId } });

    return NextResponse.json({ success: true, message: "Whiteboard deleted" });
  } catch (error) {
    console.error("Error deleting whiteboard:", error);
    return NextResponse.json({ error: "Failed to delete whiteboard" }, { status: 500 });
  }
}
