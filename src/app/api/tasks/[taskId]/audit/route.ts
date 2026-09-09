import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { db } from "@/lib/db";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { startAudit } from "@/services/auditor/trigger";

export const fetchCache = "force-no-store";

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { taskId } = await params;
    if (!taskId) {
      return NextResponse.json({ error: "Task ID required" }, { status: 400 });
    }

    const task = await db.task.findUnique({
      where: { id: taskId, deleted: false },
      select: { id: true, workspaceId: true },
    });

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const access = await validateWorkspaceAccessById(task.workspaceId, userOrResponse.id);
    if (!access.hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await startAudit(taskId, userOrResponse.id);

    if (!result.success) {
      return NextResponse.json({ error: result.error ?? "Failed to start audit" }, { status: 502 });
    }

    return NextResponse.json({ success: true, data: result }, { status: 202 });
  } catch (error) {
    console.error("Error starting audit:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
