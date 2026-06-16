import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { findStalePRTasks, archiveStalePRTasks } from "@/lib/github/stale-pr-janitor";

const bodySchema = z.object({
  mode: z.enum(["dry_run", "execute"]),
  thresholdDays: z.number().int().min(1).max(365).optional(),
  workspaceId: z.string().optional(),
  repoUrl: z.string().optional(),
  taskIds: z.array(z.string()).optional(),
});

export async function POST(request: NextRequest) {
  const authResult = await requireSuperAdmin(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { mode, workspaceId, repoUrl, taskIds } = parsed.data;
    const thresholdDays = parsed.data.thresholdDays ?? 7;

    // IDOR guard when both taskIds and workspaceId are provided
    if (taskIds && taskIds.length > 0 && workspaceId) {
      const owned = await db.task.findMany({
        where: { id: { in: taskIds }, workspaceId },
        select: { id: true },
      });
      if (owned.length !== taskIds.length) {
        return NextResponse.json(
          { error: "One or more task IDs do not belong to the specified workspace" },
          { status: 403 },
        );
      }
    }

    // When taskIds provided without workspaceId, verify tasks exist and aren't deleted
    if (taskIds && taskIds.length > 0 && !workspaceId) {
      const existing = await db.task.findMany({
        where: { id: { in: taskIds }, deleted: false },
        select: { id: true },
      });
      if (existing.length !== taskIds.length) {
        return NextResponse.json(
          { error: "One or more task IDs not found or are deleted" },
          { status: 404 },
        );
      }
    }

    const tasks = await findStalePRTasks({
      workspaceId,
      repoUrl,
      thresholdDays,
      taskIds,
    });

    if (mode === "dry_run") {
      return NextResponse.json({ tasks, total: tasks.length });
    }

    // execute mode
    const { archivedCount, closedPrCount } = await archiveStalePRTasks(tasks);
    return NextResponse.json({ archivedCount, closedPrCount, tasks });
  } catch (error) {
    console.error("Error in admin stale-pr-tasks janitor:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
