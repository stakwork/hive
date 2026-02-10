import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getBasicVMDataFromPods } from "@/lib/pods/capacity-queries";

export async function GET(
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

    const { db } = await import("@/lib/db");
    const swarm = await db.swarm.findFirst({
      where: {
        workspaceId: workspace.id,
      },
      select: {
        id: true,
        poolName: true,
      },
    });

    if (!swarm?.id) {
      return NextResponse.json(
        { success: false, message: "Pool not configured for this workspace" },
        { status: 404 }
      );
    }

    // Fast database-only query
    const workspaces = await getBasicVMDataFromPods(swarm.id);

    return NextResponse.json({
      success: true,
      data: {
        pool_name: swarm.poolName || swarm.id,
        workspaces,
      },
    });
  } catch (error) {
    console.error("Error in basic workspaces endpoint:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
