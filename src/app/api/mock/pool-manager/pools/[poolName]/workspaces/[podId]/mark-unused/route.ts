import { NextRequest, NextResponse } from "next/server";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * Mock Pool Manager mark workspace as unused endpoint (drop pod)
 * POST /api/mock/pool-manager/pools/[poolName]/workspaces/[podId]/mark-unused
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
      message: `Workspace ${podId} marked as unused`,
    });
  } catch (error) {
    console.error("Mock Pool Manager mark-unused error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
