import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateFeatureAccess } from "@/services/roadmap/utils";
import { updateFeatureStatusFromTasks } from "@/services/roadmap/feature-status-sync";
import { notifyFeatureCanvasRefresh } from "@/lib/canvas";
import { db } from "@/lib/db";
import { SystemAssigneeType } from "@prisma/client";
import { getPoolStatusFromPods } from "@/lib/pods/status-queries";
import { processTicketSweep, processWorkflowTaskSweep } from "@/services/task-coordinator-cron";

interface AssignAllResponse {
  success: boolean;
  count: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    // Step 1: Authenticate user
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;

    // Step 2: Validate feature access
    await validateFeatureAccess(featureId, userOrResponse.id);

    // Step 3: Fetch feature with first phase
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        status: true,
        workspace: {
          select: {
            id: true,
            slug: true,
            swarm: {
              select: { id: true },
            },
          },
        },
        phases: {
          orderBy: { order: "asc" },
          take: 1,
          select: {
            id: true,
          },
        },
      },
    });

    if (!feature) {
      return NextResponse.json(
        { error: "Feature not found" },
        { status: 404 }
      );
    }

    if (feature.status === "CANCELLED") {
      return NextResponse.json(
        { error: "Cannot assign tasks for a cancelled feature" },
        { status: 400 }
      );
    }

    // Step 4: Get first phase
    const firstPhase = feature.phases[0];
    if (!firstPhase) {
      return NextResponse.json(
        { error: "Feature has no phases" },
        { status: 400 }
      );
    }

    // Step 5: Count all unassigned TODO tasks in first phase
    // Only assign tasks that are in TODO status (not IN_PROGRESS or DONE)
    const unassignedTaskIds = await db.task.findMany({
      where: {
        phaseId: firstPhase.id,
        assigneeId: null,
        systemAssigneeType: null,
        deleted: false,
        status: "TODO",
      },
      select: { id: true },
    });

    // Step 6: If no unassigned tasks, return early
    if (unassignedTaskIds.length === 0) {
      return NextResponse.json<AssignAllResponse>(
        {
          success: true,
          count: 0,
        },
        { status: 200 }
      );
    }

    // Step 7: Bulk assign ALL unassigned TODO tasks (repo + workflow) to Task Coordinator
    const updateResult = await db.task.updateMany({
      where: {
        id: { in: unassignedTaskIds.map((t) => t.id) },
      },
      data: {
        assigneeId: null,
        systemAssigneeType: SystemAssigneeType.TASK_COORDINATOR,
      },
    });
    const assignedCount = updateResult.count;

    // Step 8: Eagerly trigger sweeps
    const ws = feature.workspace;
    const swarm = ws?.swarm;
    if (ws) {
      // Workflow sweep always runs unconditionally (no pod needed)
      processWorkflowTaskSweep(ws.id, ws.slug).catch(() => {});

      // Pod-gated repo sweep only when machines are available
      if (swarm?.id) {
        try {
          const poolStatus = await getPoolStatusFromPods(swarm.id, ws.id);
          if (poolStatus.unusedVms > 1) {
            processTicketSweep(ws.id, ws.slug, poolStatus.unusedVms - 1).catch(() => {});
          }
        } catch {
          // Pool query failed — skip eager start
        }
      }
    }

    // Step 9: Update feature status from tasks
    await updateFeatureStatusFromTasks(featureId);

    // Org canvas refresh — assigning a batch of tasks typically
    // moves them from PENDING (idle) into IN_PROGRESS (agent
    // running), which the milestone's agent-count badge surfaces.
    void notifyFeatureCanvasRefresh(featureId, "tasks-assigned");

    // Step 10: Return success response (count covers both repo + workflow tasks)
    return NextResponse.json<AssignAllResponse>(
      {
        success: true,
        count: assignedCount,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error bulk assigning tasks:", error);
    const message =
      error instanceof Error ? error.message : "Failed to assign tasks";

    let status = 500;
    if (message.includes("not found")) status = 404;
    else if (message.includes("denied")) status = 403;
    else if (message.includes("required") || message.includes("Invalid"))
      status = 400;

    return NextResponse.json({ error: message }, { status });
  }
}
