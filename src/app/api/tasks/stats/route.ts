import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@/lib/chat";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId query parameter is required" },
        { status: 400 },
      );
    }

    // Verify workspace exists and user has access
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        deleted: false,
      },
      select: {
        id: true,
        ownerId: true,
        members: {
          where: {
            userId: userId,
          },
          select: {
            role: true,
          },
        },
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    // Check if user is workspace owner or member
    const isOwner = workspace.ownerId === userId;
    const isMember = workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get task statistics
    const [
      totalCount,
      inProgressCount,
      waitingForInputCount,
    ] = await Promise.all([
      // Total tasks
      db.task.count({
        where: {
          workspaceId,
          deleted: false,
        },
      }),
      // Tasks with IN_PROGRESS workflow status
      db.task.count({
        where: {
          workspaceId,
          deleted: false,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      }),
      // Tasks waiting for input (have FORM artifacts in latest message AND are active)
      db.task.count({
        where: {
          workspaceId,
          deleted: false,
          workflowStatus: {
            in: [WorkflowStatus.IN_PROGRESS, WorkflowStatus.PENDING],
          },
          chatMessages: {
            some: {
              artifacts: {
                some: {
                  type: "FORM",
                },
              },
            },
          },
        },
      }),
    ]);

    return NextResponse.json(
      {
        success: true,
        data: {
          total: totalCount,
          inProgress: inProgressCount,
          waitingForInput: waitingForInputCount,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching task statistics:", error);
    return NextResponse.json(
      { error: "Failed to fetch task statistics" },
      { status: 500 },
    );
  }
}