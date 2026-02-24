import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { createDiagramStakworkRun } from "@/services/stakwork-run";

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

    // Fetch messages ordered by creation time
    const messages = await db.whiteboardMessage.findMany({
      where: { whiteboardId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ success: true, data: messages });
  } catch (error) {
    console.error("Error fetching whiteboard messages:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ whiteboardId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;
    const user = userOrResponse;

    const { whiteboardId } = await params;
    const body = await request.json();

    // Validate request body
    if (!body.content || typeof body.content !== "string") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    // Fetch whiteboard with workspace access check and feature data
    const whiteboard = await db.whiteboard.findUnique({
      where: { id: whiteboardId },
      include: {
        workspace: {
          select: {
            id: true,
            ownerId: true,
            members: {
              where: { userId: user.id },
              select: { role: true },
            },
          },
        },
        feature: {
          select: {
            id: true,
            architecture: true,
            workspaceId: true,
          },
        },
      },
    });

    if (!whiteboard) {
      return NextResponse.json({ error: "Whiteboard not found" }, { status: 404 });
    }

    // Check workspace access
    const isOwner = whiteboard.workspace.ownerId === user.id;
    const isMember = whiteboard.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Validate whiteboard has linked feature with architecture
    if (!whiteboard.featureId) {
      return NextResponse.json(
        { error: "Whiteboard must be linked to a feature" },
        { status: 400 }
      );
    }

    if (!whiteboard.feature?.architecture) {
      return NextResponse.json(
        { error: "Feature must have architecture text" },
        { status: 400 }
      );
    }

    // Guard against concurrent diagram generation
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

    // Persist USER message
    const message = await db.whiteboardMessage.create({
      data: {
        whiteboardId,
        role: "USER",
        content: body.content,
        status: "SENT",
        userId: user.id,
      },
    });

    // Trigger diagram generation
    const layout = body.layout || "layered";
    const run = await createDiagramStakworkRun({
      workspaceId: whiteboard.feature.workspaceId,
      featureId: whiteboard.featureId,
      architectureText: whiteboard.feature.architecture,
      layout,
      userId: user.id,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          message,
          runId: run.id,
        },
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("Error creating whiteboard message:", error);
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 });
  }
}
