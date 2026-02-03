import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { pusherServer, getWhiteboardChannelName, PUSHER_EVENTS } from "@/lib/pusher";
import { logger } from "@/lib/logger";

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

    // Handle featureId linking/unlinking (null to unlink)
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.elements !== undefined) updateData.elements = body.elements;
    if (body.appState !== undefined) updateData.appState = body.appState;
    if (body.files !== undefined) updateData.files = body.files;
    if ("featureId" in body) updateData.featureId = body.featureId;

    const updated = await db.whiteboard.update({
      where: { id: whiteboardId },
      data: updateData,
      include: {
        feature: {
          select: { id: true, title: true },
        },
      },
    });

    // Broadcast content updates via Pusher (not name/featureId changes)
    const shouldBroadcast = 
      body.elements !== undefined || 
      body.appState !== undefined || 
      body.files !== undefined;

    if (shouldBroadcast) {
      try {
        await pusherServer.trigger(
          getWhiteboardChannelName(whiteboardId),
          PUSHER_EVENTS.WHITEBOARD_UPDATE,
          {
            whiteboardId,
            elements: updateData.elements,
            appState: updateData.appState,
            files: updateData.files,
            timestamp: new Date(),
            updatedBy: userOrResponse.id,
          }
        );
      } catch (error) {
        // Log but don't fail the request if Pusher fails
        logger.error("Failed to broadcast whiteboard update via Pusher", "WHITEBOARD_PUSHER", {
          error: error instanceof Error ? error.message : String(error),
          whiteboardId,
        });
      }
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
