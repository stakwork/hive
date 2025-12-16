import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager pod release endpoint
 * POST /api/mock/pool-manager/pools/[poolName]/workspaces/[podId]/release
 */

interface RouteContext {
  params: Promise<{
    poolName: string;
    podId: string;
  }>;
}

export async function POST(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { poolName, podId } = await context.params;

    const released = mockPoolState.releasePod(poolName, podId);
    if (!released) {
      return NextResponse.json(
        { error: "Pod not found or already released" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Pod ${podId} released from pool ${poolName}`,
      podId,
      poolName,
    });
  } catch (error) {
    console.error("Mock Pool Manager release pod error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
