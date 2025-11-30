import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../../../../state";

/**
 * Mock Pool Manager - Mark Workspace as Unused
 * POST /api/mock/pool-manager/pools/[poolName]/workspaces/[workspaceId]/mark-unused
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ poolName: string; workspaceId: string }> }
) {
  try {
    const { poolName, workspaceId } = await params;
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const success = poolManagerState.markWorkspaceUnused(poolName, workspaceId);

    if (!success) {
      return NextResponse.json(
        { success: false, error: "Workspace not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Workspace marked as unused",
    });
  } catch (error) {
    console.error("Mock Pool Manager mark unused error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to mark workspace as unused" },
      { status: 500 }
    );
  }
}