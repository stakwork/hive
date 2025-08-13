import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { type ChatMessage, type ContextTag, type Artifact } from "@/lib/chat";

// Disable caching for real-time messaging
export const fetchCache = "force-no-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
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

    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json(
        { error: "Task ID is required" },
        { status: 400 },
      );
    }

    // Verify task exists and user has access through workspace
    const task = await db.task.findFirst({
      where: {
        id: taskId,
        deleted: false,
      },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        workflowStatus: true,
        stakworkProjectId: true,
        workspace: {
          select: {
            id: true,
            name: true,
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
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Check if user is workspace owner or member
    const isOwner = task.workspace.ownerId === userId;
    const isMember = task.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Get all chat messages for the task
    const chatMessages = await db.chatMessage.findMany({
      where: {
        taskId: taskId,
      },
      include: {
        artifacts: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
      orderBy: {
        timestamp: "asc", // Show messages in chronological order
      },
    });

    // Convert to client-side types with proper JSON parsing
    const clientMessages: ChatMessage[] = chatMessages.map((msg) => ({
      ...msg,
      contextTags: JSON.parse(msg.contextTags as string) as ContextTag[],
      artifacts: msg.artifacts.map((artifact) => ({
        ...artifact,
        content: artifact.content as unknown,
      })) as Artifact[],
    }));

    return NextResponse.json(
      {
        success: true,
        data: {
          task: {
            id: task.id,
            title: task.title,
            workspaceId: task.workspaceId,
            workflowStatus: task.workflowStatus,
            stakworkProjectId: task.stakworkProjectId,
          },
          messages: clientMessages,
          count: clientMessages.length,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching chat messages for task:", error);
    return NextResponse.json(
      { error: "Failed to fetch chat messages" },
      { status: 500 },
    );
  }
}
