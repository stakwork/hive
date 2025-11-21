import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@/lib/chat";

export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId query parameter is required" }, { status: 400 });
    }

    // Validate workspace access
    const workspaceAccess = await validateWorkspaceAccessById(workspaceId, userOrResponse.id);
    if (!workspaceAccess.hasAccess) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 403 });
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
