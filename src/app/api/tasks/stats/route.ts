import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@/lib/chat";
export async function GET(request: Request) {
  try {
    const userId = request.headers.get("x-middleware-user-id");
    const workspaceId = request.headers.get("x-middleware-workspace-id");

    if (!userId || !workspaceId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get task statistics
    const [totalCount, inProgressCount, waitingForInputCount] = await Promise.all([
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
    return NextResponse.json({ error: "Failed to fetch task statistics" }, { status: 500 });
  }
}
