import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateFeatureAccess } from "@/services/roadmap/utils";
import { updateFeatureStatusFromTasks } from "@/services/roadmap/feature-status-sync";
import { db } from "@/lib/db";

interface AssignAllResponse {
  success: boolean;
  count: number;
  assignee?: {
    name: string | null;
    email: string | null;
  } | null;
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

    // Step 3: Fetch feature with assigneeId and first phase
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        assigneeId: true,
        assignee: {
          select: {
            name: true,
            email: true,
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

    // Step 4: Get first phase
    const firstPhase = feature.phases[0];
    if (!firstPhase) {
      return NextResponse.json(
        { error: "Feature has no phases" },
        { status: 400 }
      );
    }

    // Step 5: Query all unassigned tasks in first phase
    const unassignedTasks = await db.task.findMany({
      where: {
        phaseId: firstPhase.id,
        assigneeId: null,
        systemAssigneeType: null,
        deleted: false,
      },
      select: {
        id: true,
      },
    });

    // Step 6: If no unassigned tasks, return early
    if (unassignedTasks.length === 0) {
      return NextResponse.json<AssignAllResponse>(
        {
          success: true,
          count: 0,
          assignee: feature.assignee,
        },
        { status: 200 }
      );
    }

    // Step 7: Bulk update tasks with feature's assigneeId
    const result = await db.task.updateMany({
      where: {
        id: {
          in: unassignedTasks.map((task) => task.id),
        },
      },
      data: {
        assigneeId: feature.assigneeId,
        systemAssigneeType: null, // Clear system assignee type
      },
    });

    // Step 8: Update feature status from tasks
    await updateFeatureStatusFromTasks(featureId);

    // Step 9: Return success response
    return NextResponse.json<AssignAllResponse>(
      {
        success: true,
        count: result.count,
        assignee: feature.assignee,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error bulk assigning tasks:", error);
    const message =
      error instanceof Error ? error.message : "Failed to assign tasks";
    const status = message.includes("not found")
      ? 404
      : message.includes("denied")
        ? 403
        : message.includes("required") || message.includes("Invalid")
          ? 400
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
