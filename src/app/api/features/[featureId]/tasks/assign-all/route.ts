import { NextRequest, NextResponse, after } from "next/server";
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

/**
 * Tasks that are "ready to start" — unassigned TODO tasks in the
 * feature's FIRST phase. Mirrors the POST handler's assignment scope
 * exactly so the count the UI shows matches what a click will assign.
 */
async function countReadyTasks(featureId: string): Promise<number> {
  const firstPhase = await db.phase.findFirst({
    where: { featureId },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  if (!firstPhase) return 0;
  return db.task.count({
    where: {
      phaseId: firstPhase.id,
      assigneeId: null,
      systemAssigneeType: null,
      deleted: false,
      status: "TODO",
    },
  });
}

/**
 * GET /api/features/[featureId]/tasks/assign-all
 *
 * Returns `{ readyCount }` — how many tasks the POST would assign right
 * now. Powers the canvas-chat `StartTasksSlot` "Start N tasks" button.
 * Same auth as POST (session + feature access).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> },
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;
    await validateFeatureAccess(featureId, userOrResponse.id);

    const readyCount = await countReadyTasks(featureId);
    return NextResponse.json({ readyCount }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to count ready tasks";
    let status = 500;
    if (message.includes("not found")) status = 404;
    else if (message.includes("denied")) status = 403;
    return NextResponse.json({ error: message }, { status });
  }
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

    // Step 8: Eagerly trigger sweeps.
    //
    // Run these in `after()` rather than fire-and-forget. On Vercel the lambda
    // is frozen once the HTTP response is sent, which can suspend a dispatch
    // between its committed IN_PROGRESS claim and the compensating rollback —
    // stranding the task in limbo (IN_PROGRESS with no stakworkProjectId) until
    // the 24h stale sweep rescues it. `after()` keeps the function alive until
    // the sweeps settle, so a failed dispatch rolls itself back to PENDING.
    const ws = feature.workspace;
    const swarm = ws?.swarm;
    if (ws) {
      const runEagerSweeps = async () => {
        // Workflow sweep always runs unconditionally (no pod needed)
        try {
          await processWorkflowTaskSweep(ws.id, ws.slug);
        } catch (error) {
          console.error("Eager workflow task sweep failed:", error);
        }

        // Pod-gated repo sweep only when machines are available
        if (swarm?.id) {
          try {
            const poolStatus = await getPoolStatusFromPods(swarm.id, ws.id);
            if (poolStatus.unusedVms > 1) {
              await processTicketSweep(ws.id, ws.slug, poolStatus.unusedVms - 1);
            }
          } catch (error) {
            console.error("Eager ticket sweep failed:", error);
          }
        }
      };

      try {
        after(runEagerSweeps);
      } catch {
        // `after()` throws only when there is no request scope — e.g. when the
        // handler is invoked directly (tests). The 5-min coordinator cron is the
        // backstop that will pick these tasks up, so skip the eager kick here.
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
