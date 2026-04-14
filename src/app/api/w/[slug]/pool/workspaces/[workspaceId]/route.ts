import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceBySlug } from "@/services/workspace";
import { poolManagerService } from "@/lib/service-factory";
import { softDeletePodByPodId } from "@/lib/pods/queries";
import { NextRequest, NextResponse } from "next/server";

interface RouteContext {
  params: Promise<{
    slug: string;
    workspaceId: string;
  }>;
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug, workspaceId } = await params;

    if (!slug) {
      return NextResponse.json({ error: "Workspace slug is required" }, { status: 400 });
    }

    const workspace = await getWorkspaceBySlug(slug, userOrResponse.id);

    if (!workspace) {
      return NextResponse.json({ error: "Workspace not found or access denied" }, { status: 404 });
    }

    if (workspace.userRole !== "OWNER" && workspace.userRole !== "ADMIN") {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const swarm = await db.swarm.findFirst({
      where: { workspaceId: workspace.id },
      select: { id: true, poolApiKey: true },
    });

    if (!swarm?.poolApiKey) {
      return NextResponse.json({ error: "Pool not configured for this workspace" }, { status: 404 });
    }

    // Step 1: Mark deleted in DB first
    await softDeletePodByPodId(workspaceId);

    // Step 2: Delete from pool manager
    await poolManagerService().deletePodFromPool(swarm.id, workspaceId, swarm.poolApiKey);

    // Best-effort: atomically clear pod refs from any task that still references this pod.
    // Follows the SELECT FOR UPDATE pattern from claimAvailablePod in queries.ts.
    try {
      await db.$transaction(async (tx) => {
        // Lock the pod row to prevent concurrent stale reads
        await tx.$queryRaw`
          SELECT id FROM pods
          WHERE pod_id = ${workspaceId}
          FOR UPDATE
        `;
        const updated = await tx.task.updateMany({
          where: { podId: workspaceId },
          data: { podId: null, agentPassword: null, agentUrl: null },
        });
        console.log(`[DeletePod] Cleared podId refs from ${updated.count} tasks for pod ${workspaceId}`);
      });
    } catch (err) {
      // Best-effort: pod is already deleted, cron will catch any misses
      console.error(`[DeletePod] Failed to clear task pod refs for ${workspaceId}:`, err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in delete pod endpoint:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
