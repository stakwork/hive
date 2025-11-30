import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../../state";

/**
 * GET /api/mock/pool-manager/pools/[poolName]/workspace
 * Mock endpoint to claim a pod from a pool
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ poolName: string }> }
) {
  try {
    const { poolName } = await params;
    
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId") || `workspace-${Date.now()}`;

    console.log(`🎭 [Mock Pool Manager] Claiming pod from pool: ${poolName} for workspace: ${workspaceId}`);

    const pool = poolManagerState.getOrCreatePool(poolName, "mock-api-key");
    const claimedPod = poolManagerState.claimPod(poolName, workspaceId);

    console.log(`✅ [Mock Pool Manager] Claimed pod: ${claimedPod.id}`);

    return NextResponse.json(
      {
        success: true,
        workspace: claimedPod,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ [Mock Pool Manager] Error claiming pod:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to claim pod",
      },
      { status: 500 }
    );
  }
}