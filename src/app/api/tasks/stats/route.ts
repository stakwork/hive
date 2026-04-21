import { NextRequest, NextResponse } from "next/server";
import { resolveWorkspaceAccess, requireReadAccess } from "@/lib/auth/workspace-access";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@/lib/chat";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId query parameter is required" },
        { status: 400 },
      );
    }

    const access = await resolveWorkspaceAccess(request, { workspaceId });
    const ok = requireReadAccess(access);
    if (ok instanceof NextResponse) return ok;

    // Get task statistics
    const [
      totalCount,
      inProgressCount,
      waitingForInputCount,
      queuedCount,
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
      // Coordinator-queued TODO tasks (must match /api/tasks?queue=true filters)
      db.task.count({
        where: {
          workspaceId,
          deleted: false,
          archived: false,
          status: "TODO",
          systemAssigneeType: "TASK_COORDINATOR",
          sourceType: { not: "USER_JOURNEY" },
          AND: [
            {
              OR: [
                { featureId: null },
                { feature: { status: { not: "CANCELLED" } } },
              ],
            },
          ],
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
          queuedCount,
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
