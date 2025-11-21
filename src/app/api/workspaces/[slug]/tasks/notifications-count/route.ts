import { auth } from "@/lib/auth/auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth();
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

    const { slug } = await params;
    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 },
      );
    }

    // Verify workspace exists and user has access
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
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

    // Count tasks waiting for user input (tasks with FORM artifacts in latest message only)
    // Only count tasks that are IN_PROGRESS or PENDING
    const tasksWithLatestMessage = await db.task.findMany({
      where: {
        workspaceId: workspace.id,
        deleted: false,
        workflowStatus: {
          in: ["IN_PROGRESS", "PENDING"],
        },
      },
      select: {
        id: true,
        chatMessages: {
          orderBy: {
            timestamp: "desc",
          },
          take: 1,
          select: {
            artifacts: {
              select: {
                type: true,
              },
            },
          },
        },
      },
    });

    // Count tasks where the latest message has FORM artifacts
    const waitingForInputCount = tasksWithLatestMessage.filter(task => {
      if (!task.chatMessages || task.chatMessages.length === 0) return false;
      
      const latestMessage = task.chatMessages[0];
      return latestMessage.artifacts?.some(artifact => artifact.type === 'FORM') || false;
    }).length;

    return NextResponse.json(
      {
        success: true,
        data: {
          waitingForInputCount,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching task notification count:", error);
    return NextResponse.json(
      { error: "Failed to fetch task notification count" },
      { status: 500 },
    );
  }
}