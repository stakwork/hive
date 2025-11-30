import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../../state";

/**
 * GET /api/mock/pool-manager/pools/[poolName]/workspaces
 * Mock endpoint to list all workspaces in a pool
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ poolName: string }> }
) {
  try {
    const { poolName } = await params;

    console.log(`🎭 [Mock Pool Manager] Listing workspaces for pool: ${poolName}`);

    const pool = poolManagerState.getOrCreatePool(poolName, "mock-api-key");
    const status = poolManagerState.getPoolStatus(poolName);

    return NextResponse.json(
      {
        success: true,
        workspaces: status.pods,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ [Mock Pool Manager] Error listing workspaces:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list workspaces",
      },
      { status: 500 }
    );
  }
}
