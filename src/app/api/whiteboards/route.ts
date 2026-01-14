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
    const featureId = searchParams.get("featureId");

    // If featureId is provided, get whiteboard by feature
    if (featureId) {
      const whiteboard = await db.whiteboard.findUnique({
        where: { featureId },
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
          feature: {
            select: { id: true, title: true },
          },
        },
      });

      if (!whiteboard) {
        return NextResponse.json({ success: true, data: null }, { status: 200 });
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
          feature: whiteboard.feature,
          elements: whiteboard.elements,
          appState: whiteboard.appState,
          files: whiteboard.files,
          createdAt: whiteboard.createdAt,
          updatedAt: whiteboard.updatedAt,
        },
      });
    }

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
        featureId: true,
        feature: {
          select: { id: true, title: true },
        },
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
    const { workspaceId, name, featureId, elements, appState, files } = body;

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

    // If featureId provided, verify feature exists and belongs to workspace
    if (featureId) {
      const feature = await db.feature.findFirst({
        where: { id: featureId, workspaceId, deleted: false },
      });
      if (!feature) {
        return NextResponse.json({ error: "Feature not found" }, { status: 404 });
      }
    }

    const whiteboard = await db.whiteboard.create({
      data: {
        name,
        workspaceId,
        featureId: featureId || null,
        elements: elements || [],
        appState: appState || {},
        files: files || {},
      },
      include: {
        feature: {
          select: { id: true, title: true },
        },
      },
    });

    return NextResponse.json({ success: true, data: whiteboard }, { status: 201 });
  } catch (error) {
    console.error("Error creating whiteboard:", error);
    return NextResponse.json({ error: "Failed to create whiteboard" }, { status: 500 });
  }
}
