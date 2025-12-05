import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager get pod usage endpoint
 * GET /api/mock/pool-manager/pools/[poolName]/workspaces/[podId]/usage
 * Returns the usage status and user_info for a specific pod
 */

interface RouteContext {
  params: Promise<{
    poolName: string;
    podId: string;
  }>;
}

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const { poolName, podId } = await context.params;

    // Auto-create pool if it doesn't exist
    mockPoolState.getOrCreatePool(poolName);

    const pod = mockPoolState.getPod(poolName, podId);

    if (pod === undefined) {
      return NextResponse.json(
        { error: "Pod not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      usage_status: pod.usage_status,
      user_info: pod.userInfo || null,
      workspace_id: pod.id,
    });
  } catch (error) {
    console.error("Mock Pool Manager usage error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
