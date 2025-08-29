import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { createTaskWithStakworkWorkflow } from "@/services/task-workflow";
import { Priority, TaskSourceType } from "@prisma/client";

export const runtime = "nodejs";

// Disable caching for real-time messaging
export const fetchCache = "force-no-store";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const body = await request.json();
    const { message, workspaceId } = body;

    if (!message?.trim()) {
      return NextResponse.json(
        { success: false, error: "Message is required" },
        { status: 400 },
      );
    }

    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: "Workspace ID is required" },
        { status: 400 },
      );
    }

    // Create a user task for project updates using the dedicated workflow
    try {
      const result = await createTaskWithStakworkWorkflow({
        title: "Project Update Request",
        description: "Automated project update analysis",
        workspaceId,
        priority: Priority.MEDIUM,
        sourceType: TaskSourceType.USER,
        userId: session.user.id,
        initialMessage: message.trim(),
        mode: "project-updates" // Custom mode for project updates workflow
      });

      return NextResponse.json({
        success: true,
        message: "Project update task created successfully",
        taskId: result.task.id,
        data: result,
      });
    } catch (error: any) {
      return NextResponse.json(
        { success: false, error: error.message || "Failed to create project update" },
        { status: 500 },
      );
    }

  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}