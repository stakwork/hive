import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId query parameter is required" },
        { status: 400 }
      );
    }

    // Verify user has access to workspace
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        deleted: false,
        OR: [
          { ownerId: userOrResponse.id },
          { members: { some: { userId: userOrResponse.id } } },
        ],
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const whiteboards = await db.whiteboard.findMany({
      where: { workspaceId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ success: true, data: whiteboards }, { status: 200 });
  } catch (error) {
    console.error("Error fetching whiteboards:", error);
    return NextResponse.json({ error: "Failed to fetch whiteboards" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body = await request.json();
    const { workspaceId, name, elements, appState, files } = body;

    if (!workspaceId || !name) {
      return NextResponse.json(
        { error: "Missing required fields: workspaceId, name" },
        { status: 400 }
      );
    }

    // Verify user has access to workspace
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        deleted: false,
        OR: [
          { ownerId: userOrResponse.id },
          { members: { some: { userId: userOrResponse.id } } },
        ],
      },
    });

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const whiteboard = await db.whiteboard.create({
      data: {
        name,
        workspaceId,
        elements: elements || [],
        appState: appState || {},
        files: files || {},
      },
    });

    return NextResponse.json({ success: true, data: whiteboard }, { status: 201 });
  } catch (error) {
    console.error("Error creating whiteboard:", error);
    return NextResponse.json({ error: "Failed to create whiteboard" }, { status: 500 });
  }
}
