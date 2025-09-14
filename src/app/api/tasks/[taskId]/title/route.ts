import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pusherServer, getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } from "@/lib/pusher";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    // Check API token authentication
    const apiToken = request.headers.get("x-api-token");
    if (!apiToken || apiToken !== process.env.API_TOKEN) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { taskId } = await params;

    if (!taskId) {
      return NextResponse.json(
        { error: "Task ID is required" },
        { status: 400 },
      );
    }

    // Parse request body
    const body = await request.json();
    const { title } = body;

    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { error: "Title is required and must be a string" },
        { status: 400 },
      );
    }

    // Get current task for comparison and workspace info
    const currentTask = await db.task.findFirst({
      where: {
        id: taskId,
        deleted: false,
      },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        workspace: {
          select: {
            slug: true,
          },
        },
      },
    });

    if (!currentTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const trimmedTitle = title.trim();
    const previousTitle = currentTask.title;

    // Skip update if title hasn't changed
    if (previousTitle === trimmedTitle) {
      return NextResponse.json(
        {
          success: true,
          data: currentTask,
          message: "Title unchanged",
        },
        { status: 200 },
      );
    }

    // Update the task title
    const updatedTask = await db.task.update({
      where: {
        id: taskId,
        deleted: false,
      },
      data: {
        title: trimmedTitle,
      },
      select: {
        id: true,
        title: true,
        workspaceId: true,
      },
    });

    // Broadcast title update to real-time subscribers
    try {
      const titleUpdatePayload = {
        taskId: updatedTask.id,
        newTitle: updatedTask.title,
        previousTitle,
        timestamp: new Date(),
      };

      // Broadcast to task-specific channel (for chat page)
      const taskChannelName = getTaskChannelName(updatedTask.id);
      await pusherServer.trigger(
        taskChannelName,
        PUSHER_EVENTS.TASK_TITLE_UPDATE,
        titleUpdatePayload,
      );

      // Broadcast to workspace channel (for task list)
      if (currentTask.workspace?.slug) {
        const workspaceChannelName = getWorkspaceChannelName(currentTask.workspace.slug);
        await pusherServer.trigger(
          workspaceChannelName,
          PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE,
          titleUpdatePayload,
        );
      }

      console.log(`Task title updated and broadcasted: ${taskId} -> "${updatedTask.title}"`);
    } catch (error) {
      console.error("Error broadcasting title update to Pusher:", error);
      // Don't fail the request if Pusher fails
    }

    return NextResponse.json(
      {
        success: true,
        data: updatedTask,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error updating task title:", error);

    // Handle case where task doesn't exist
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2025"
    ) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to update task title" },
      { status: 500 },
    );
  }
}
