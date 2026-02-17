import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

/**
 * GET /api/agent-logs
 *
 * Fetch agent log records for a given entity. The UI uses this to show
 * "View Agent Logs" buttons on features, tasks, etc.
 *
 * Query params (at least one filter required):
 *   workspace_id:    string  — required, for access control
 *   stakwork_run_id?: string — filter by StakworkRun
 *   task_id?:        string  — filter by Task
 */
export async function GET(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspace_id");
    const stakworkRunId = searchParams.get("stakwork_run_id");
    const taskId = searchParams.get("task_id");

    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspace_id is required" },
        { status: 400 }
      );
    }

    if (!stakworkRunId && !taskId) {
      return NextResponse.json(
        { error: "At least one of 'stakwork_run_id' or 'task_id' is required" },
        { status: 400 }
      );
    }

    // Build filter
    const where: {
      workspaceId: string;
      stakworkRunId?: string;
      taskId?: string;
    } = { workspaceId };

    if (stakworkRunId) where.stakworkRunId = stakworkRunId;
    if (taskId) where.taskId = taskId;

    const logs = await db.agentLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        blobUrl: true,
        agent: true,
        stakworkRunId: true,
        taskId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ data: logs }, { status: 200 });
  } catch (error) {
    console.error("Error fetching agent logs:", error);
    return NextResponse.json(
      { error: "Failed to fetch agent logs" },
      { status: 500 }
    );
  }
}
