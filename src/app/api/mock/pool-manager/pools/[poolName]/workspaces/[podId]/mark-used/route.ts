import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager mark workspace as used endpoint
 * POST /api/mock/pool-manager/pools/[poolName]/workspaces/[podId]/mark-used
 */

interface RouteContext {
  params: Promise<{
    poolName: string;
    podId: string;
  }>;
}

export async function POST(
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

    // Parse request body for user_info
    const body = await request.json().catch(() => ({}));
    if (body.user_info) {
      mockPoolState.updatePodUserInfo(poolName, podId, body.user_info);
    }

    // Pod is already marked as in_use when claimed, just return success
    return NextResponse.json({
      success: true,
      message: `Workspace ${podId} marked as used`,
    });
  } catch (error) {
    console.error("Mock Pool Manager mark-used error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
