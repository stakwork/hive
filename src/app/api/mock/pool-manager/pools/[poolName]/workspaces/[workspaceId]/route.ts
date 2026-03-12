import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager workspace delete endpoint
 * DELETE /api/mock/pool-manager/pools/[poolName]/workspaces/[workspaceId]
 */

interface RouteContext {
  params: Promise<{
    poolName: string;
    workspaceId: string;
  }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { poolName, workspaceId } = await context.params;
    const pool = mockPoolState.getOrCreatePool(poolName);

    const podIndex = pool.pods.findIndex((p) => p.id === workspaceId);

    if (podIndex === -1) {
      return NextResponse.json({ error: "Pod not found" }, { status: 404 });
    }

    pool.pods.splice(podIndex, 1);

    return NextResponse.json({ success: true, message: "Pod deleted" });
  } catch (error) {
    console.error("Mock Pool Manager delete workspace error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
