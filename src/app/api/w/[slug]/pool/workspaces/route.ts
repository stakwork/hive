import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceBySlug } from "@/services/workspace";
import { getServiceConfig } from "@/config/services";
import { PoolManagerService } from "@/services/pool-manager";

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
        poolApiKey: true,
      },
    });

    if (!swarm?.id || !swarm?.poolApiKey) {
      return NextResponse.json(
        { success: false, message: "Pool not configured for this workspace" },
        { status: 404 }
      );
    }

    const config = getServiceConfig("poolManager");
    const poolManagerService = new PoolManagerService(config);

    try {
      // Add 5 second timeout to pool-manager API call
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Pool manager request timeout")), 5000);
      });

      const workspacesPromise = poolManagerService.getPoolWorkspaces(swarm.id, swarm.poolApiKey);

      const workspaces = await Promise.race([workspacesPromise, timeoutPromise]);

      return NextResponse.json(
        {
          success: true,
          data: workspaces,
        },
        {
          headers: {
            "Cache-Control": "max-age=5", // Cache for 5 seconds for capacity monitoring
          },
        }
      );
    } catch (error) {
      console.warn("Pool workspaces fetch failed:", error);
      const message = error instanceof Error ? error.message : "Unable to fetch workspace data right now";
      
      // On timeout or failure, return partial data with metrics unavailable
      const { getBasicVMDataFromPods } = await import("@/lib/pods/capacity-queries");
      const basicWorkspaces = await getBasicVMDataFromPods(swarm.id);
      
      return NextResponse.json(
        {
          success: true,
          data: {
            pool_name: swarm.id,
            workspaces: basicWorkspaces,
          },
          warning: "Real-time metrics unavailable",
        },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error("Error in pool workspaces endpoint:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
