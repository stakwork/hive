import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";

/**
 * POST /api/tasks/[taskId]/workflow-task
 *
 * Upserts a WorkflowTask row for an existing task (idempotent).
 * Used by workflows/page.tsx after creating a workflow_editor task to
 * dual-write the WorkflowTask row alongside the existing WORKFLOW artifact.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { taskId } = await params;
    const body = await request.json();
    const { workflowId, workflowName, workflowRefId, workflowVersionId, workflowTaskType } = body;

    // workflowId may be null (workflow not yet assigned) or a number — reject any other type
    if (workflowId !== null && workflowId !== undefined && typeof workflowId !== "number") {
      return NextResponse.json({ error: "workflowId must be a number or null" }, { status: 400 });
    }

    // Verify task exists and user has access
    const task = await db.task.findFirst({
      where: { id: taskId, deleted: false },
      select: {
        workspaceId: true,
        workspace: {
          select: {
            ownerId: true,
            members: {
              where: { userId: userOrResponse.id },
              select: { role: true },
            },
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const isOwner = task.workspace.ownerId === userOrResponse.id;
    const isMember = task.workspace.members.length > 0;
    if (!isOwner && !isMember) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const workflowTask = await db.workflowTask.upsert({
      where: { taskId },
      create: {
        taskId,
        workflowId: workflowId ?? null,
        workflowName: workflowName ?? null,
        workflowRefId: workflowRefId ?? null,
        workflowVersionId: workflowVersionId ?? null,
        workflowTaskType: workflowTaskType ?? null,
      },
      update: {
        workflowId: workflowId ?? null,
        workflowName: workflowName ?? null,
        workflowRefId: workflowRefId ?? null,
        workflowVersionId: workflowVersionId ?? null,
        workflowTaskType: workflowTaskType ?? undefined,
      },
    });

    return NextResponse.json({ success: true, data: workflowTask }, { status: 200 });
  } catch (error) {
    console.error("Error upserting WorkflowTask:", error);
    return NextResponse.json({ error: "Failed to upsert workflow task" }, { status: 500 });
  }
}
