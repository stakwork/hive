import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { checkIsSuperAdmin } from "@/lib/middleware/utils";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getPoolStatusFromPods } from "@/lib/pods/status-queries";

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

    const isSuperAdmin = await checkIsSuperAdmin(userOrResponse.id);


    const workspace = await getWorkspaceBySlug(slug, userOrResponse.id, { isSuperAdmin });

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
      },
    });

    if (!swarm?.id) {
      return NextResponse.json(
        { success: false, message: "Pool not configured for this workspace" },
        { status: 404 }
      );
    }

    try {
      const poolStatus = await getPoolStatusFromPods(swarm.id);

      return NextResponse.json({
        success: true,
        data: {
          status: poolStatus,
        },
      });
    } catch (error) {
      console.error("Database query failed:", error);
      const message = error instanceof Error ? error.message : "Unable to fetch pool data right now";
      return NextResponse.json(
        {
          success: false,
          message,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error in pool status endpoint:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
