import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../../state";

/**
 * GET /api/mock/pool-manager/pools/[poolName]/status
 * Mock endpoint to get pool status
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ poolName: string }> }
) {
  try {
    const { poolName } = await params;

    console.log(`🎭 [Mock Pool Manager] Getting status for pool: ${poolName}`);

    const pool = poolManagerState.getOrCreatePool(poolName, "mock-api-key");
    const status = poolManagerState.getPoolStatus(poolName);

    return NextResponse.json(
      {
        success: true,
        pool: {
          name: pool.name,
          id: pool.id,
          total_workspaces: status.total,
          available_workspaces: status.available,
          used_workspaces: status.claimed,
        },
        workspaces: status.pods.map(pod => ({
          id: pod.id,
          status: pod.usage_status,
          claimed_by: pod.claimedBy,
          claimed_at: pod.claimedAt,
          url: pod.url,
        })),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ [Mock Pool Manager] Error getting pool status:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get pool status",
      },
      { status: 500 }
    );
  }
}
