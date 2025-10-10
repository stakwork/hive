import { NextRequest, NextResponse } from "next/server";
import { getServiceConfig } from "@/config/services";
import { PoolManagerService } from "@/services/pool-manager";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    if (!slug) {
      return NextResponse.json({ error: "Workspace slug is required" }, { status: 400 });
    }

    const workspaceIdRaw = request.headers.get("x-middleware-workspace-id");
    const workspaceId = workspaceIdRaw || undefined;

    const { db } = await import("@/lib/db");
    const swarm = await db.swarm.findFirst({
      where: {
        workspaceId,
      },
      select: {
        id: true,
        poolApiKey: true,
      },
    });

    if (!swarm?.id || !swarm?.poolApiKey) {
      return NextResponse.json({ success: false, message: "Pool not configured for this workspace" }, { status: 404 });
    }

    const config = getServiceConfig("poolManager");
    const poolManagerService = new PoolManagerService(config);

    try {
      const poolStatus = await poolManagerService.getPoolStatus(swarm.id, swarm.poolApiKey);

      return NextResponse.json({
        success: true,
        data: poolStatus,
      });
    } catch (error) {
      console.warn("Pool status fetch failed (pool may still be active):", error);
      const message = error instanceof Error ? error.message : "Unable to fetch pool data right now";
      return NextResponse.json(
        {
          success: false,
          message,
        },
        { status: 503 },
      );
    }
  } catch (error) {
    console.error("Error in pool status endpoint:", error);
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
