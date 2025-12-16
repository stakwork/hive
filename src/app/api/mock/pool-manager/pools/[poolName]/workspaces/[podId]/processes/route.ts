import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager pod processes endpoint
 * GET /api/mock/pool-manager/pools/[poolName]/workspaces/[podId]/processes
 * Returns mock process list similar to PM2
 */

interface RouteContext {
  params: Promise<{
    poolName: string;
    podId: string;
  }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { poolName, podId } = await context.params;

    const processes = mockPoolState.getMockProcesses(poolName, podId);

    return NextResponse.json({
      success: true,
      processes,
      podId,
    });
  } catch (error) {
    console.error("Mock Pool Manager get processes error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
