import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../../state";

/**
 * Mock Pool Manager - Claim Workspace
 * GET /api/mock/pool-manager/pools/[poolName]/workspace
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ poolName: string }> }
) {
  try {
    const { poolName } = await params;
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const workspace = poolManagerState.claimWorkspace(poolName);

    if (!workspace) {
      return NextResponse.json(
        { success: false, error: "No available workspaces" },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      workspace,
    });
  } catch (error) {
    console.error("Mock Pool Manager claim workspace error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to claim workspace" },
      { status: 500 }
    );
  }
}