import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { config } from "@/lib/env";
import { ServiceFactory } from "@/lib/service-factory";
import { StakworkService } from "@/services/stakwork";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    // Get user session
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { taskId } = await params;

    // Get the task with workspace and stakwork project details
    const task = await db.task.findFirst({
      where: {
        id: taskId,
        deleted: false,
      },
      select: {
        id: true,
        workspaceId: true,
        workflowStatus: true,
        stakworkProjectId: true,
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            ownerId: true,
            stakworkApiKey: true,
            members: {
              where: {
                userId: session.user.id,
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
    const isOwner = task.workspace.ownerId === session.user.id;
    const isMember = task.workspace.members.length > 0;

    if (!isOwner && !isMember) {
      return NextResponse.json(
        { error: "Access denied to workspace" },
        { status: 403 }
      );
    }

    // Check if task has a stakwork project ID and is currently running
    if (!task.stakworkProjectId) {
      return NextResponse.json(
        { error: "Task has no associated Stakwork project" },
        { status: 400 }
      );
    }

    if (task.workflowStatus !== "IN_PROGRESS") {
      return NextResponse.json(
        { error: "Task is not currently running" },
        { status: 400 }
      );
    }

    // Validate Stakwork API configuration
    if (!config.STAKWORK_API_KEY || !config.STAKWORK_BASE_URL) {
      return NextResponse.json(
        { error: "Stakwork API not configured" },
        { status: 500 }
      );
    }

    try {
      // Get the Stakwork service instance
      const stakworkService = ServiceFactory.getService<StakworkService>("stakwork");

      // Call Stakwork stop API
      await stakworkService.stopProject(task.stakworkProjectId);

      // Update task status to CANCELLED
      const updatedTask = await db.task.update({
        where: { id: taskId },
        data: {
          workflowStatus: "CANCELLED",
          workflowCompletedAt: new Date(),
          updatedById: session.user.id,
        },
      });

      return NextResponse.json({
        success: true,
        task: {
          id: updatedTask.id,
          workflowStatus: updatedTask.workflowStatus,
          workflowCompletedAt: updatedTask.workflowCompletedAt,
        },
      });
    } catch (stakworkError) {
      console.error("Error stopping Stakwork project:", stakworkError);
      
      // Even if Stakwork API fails, we should still mark the task as cancelled
      // to prevent it from being stuck in running state
      const updatedTask = await db.task.update({
        where: { id: taskId },
        data: {
          workflowStatus: "CANCELLED",
          workflowCompletedAt: new Date(),
          updatedById: session.user.id,
        },
      });

      return NextResponse.json({
        success: true,
        task: {
          id: updatedTask.id,
          workflowStatus: updatedTask.workflowStatus,
          workflowCompletedAt: updatedTask.workflowCompletedAt,
        },
        warning: "Task stopped but Stakwork API call failed",
      });
    }
  } catch (error) {
    console.error("Error stopping task:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}