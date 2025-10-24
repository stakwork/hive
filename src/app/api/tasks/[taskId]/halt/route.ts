import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@/lib/chat";

export async function POST(request: NextRequest, { params }: { params: { taskId: string } }) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { taskId } = params;

    if (!taskId) {
      return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
    }

    // Get task to verify it exists and is an agent task
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { mode: true, workflowStatus: true },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Only update agent tasks that are currently in progress
    if (task.mode === "agent" && task.workflowStatus === WorkflowStatus.IN_PROGRESS) {
      await db.task.update({
        where: { id: taskId },
        data: {
          workflowStatus: WorkflowStatus.HALTED,
        },
      });

      console.log(`✅ Updated agent task ${taskId} workflow status to HALTED`);

      return NextResponse.json(
        {
          success: true,
          message: "Task halted successfully",
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: "Task does not need halting",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error halting task:", error);
    return NextResponse.json({ error: "Failed to halt task" }, { status: 500 });
  }
}
