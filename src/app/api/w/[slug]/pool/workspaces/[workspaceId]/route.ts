import { db } from "@/lib/db";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceBySlug } from "@/services/workspace";
import { poolManagerService } from "@/lib/service-factory";
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

    const swarm = await db.swarms.findFirst({
      where: { workspaceId: workspace.id },
      select: { id: true, poolApiKey: true },
    });

    if (!swarm?.poolApiKey) {
      return NextResponse.json({ error: "Pool not configured for this workspace" }, { status: 404 });
    }

    await poolManagerService().deletePodFromPool(swarm.id, workspaceId, swarm.poolApiKey);

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
