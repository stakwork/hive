import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { findStalePRTasks, archiveStalePRTasks } from "@/lib/github/stale-pr-janitor";

const bodySchema = z.object({
  mode: z.enum(["dry_run", "execute"]),
  thresholdDays: z.number().int().min(1).max(365).optional(),
  repoUrl: z.string().optional(),
  taskIds: z.array(z.string()).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string })?.id;

    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const access = await validateWorkspaceAccess(slug, userId);

    if (!access.hasAccess || !access.canWrite) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const workspace = access.workspace!;

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { mode, repoUrl, taskIds } = parsed.data;

    // IDOR guard: when taskIds are provided, verify ALL belong to this workspace
    if (taskIds && taskIds.length > 0) {
      const owned = await db.task.findMany({
        where: { id: { in: taskIds }, workspace: { slug } },
        select: { id: true },
      });
      if (owned.length !== taskIds.length) {
        return NextResponse.json(
          { error: "One or more task IDs do not belong to this workspace" },
          { status: 403 },
        );
      }
    }

    // Load threshold from JanitorConfig, falling back to default of 7
    let thresholdDays = parsed.data.thresholdDays;
    if (thresholdDays === undefined) {
      const config = await db.janitorConfig.findUnique({
        where: { workspaceId: workspace.id },
        select: { stalePrTaskThresholdDays: true },
      });
      thresholdDays = config?.stalePrTaskThresholdDays ?? 7;
    }

    const tasks = await findStalePRTasks({
      workspaceId: workspace.id,
      repoUrl,
      thresholdDays,
      taskIds,
    });

    if (mode === "dry_run") {
      return NextResponse.json({ tasks, total: tasks.length });
    }

    // execute mode
    const { archivedCount } = await archiveStalePRTasks(tasks);
    return NextResponse.json({ archivedCount, tasks });
  } catch (error) {
    console.error("Error in stale-pr-tasks janitor:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
