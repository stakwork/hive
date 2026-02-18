import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceBySlug } from "@/services/workspace";
import { isRepairInProgress, triggerPodRepair } from "@/services/pod-repair-cron";
import { poolManagerService } from "@/lib/service-factory";
import { db } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;

    if (!slug) {
      return NextResponse.json(
        { error: "Workspace slug is required" },
        { status: 400 }
      );
    }

    const workspace = await getWorkspaceBySlug(slug, userOrResponse.id);

    if (!workspace) {
      return NextResponse.json(
        { error: "Workspace not found or access denied" },
        { status: 404 }
      );
    }

    if (workspace.userRole !== "OWNER" && workspace.userRole !== "ADMIN") {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const swarm = await db.swarm.findFirst({
      where: { workspaceId: workspace.id },
      select: {
        id: true,
        poolApiKey: true,
        description: true,
      },
    });

    if (!swarm?.poolApiKey) {
      return NextResponse.json(
        { error: "Pool not configured for this workspace" },
        { status: 404 }
      );
    }

    const alreadyRunning = await isRepairInProgress(workspace.id);
    if (alreadyRunning) {
      return NextResponse.json(
        { error: "A repair is already in progress" },
        { status: 409 }
      );
    }

    const poolService = poolManagerService();
    const poolData = await poolService.getPoolWorkspaces(
      swarm.id,
      swarm.poolApiKey
    );

    const pod = poolData.workspaces.find(
      (vm) =>
        vm.usage_status !== "used" && vm.state.toLowerCase() === "running"
    ) || poolData.workspaces[0];

    if (!pod) {
      return NextResponse.json(
        { error: "No available running pods found" },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message : undefined;

    const { runId, projectId } = await triggerPodRepair(
      workspace.id,
      slug,
      pod.subdomain,
      pod.password || "",
      [],
      message,
      swarm.description || undefined
    );

    return NextResponse.json({ success: true, runId, projectId });
  } catch (error) {
    console.error("Error in pool repair endpoint:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
