import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../state";

/**
 * Mock Pool Manager - Get Workspace by ID
 * GET /api/mock/pool-manager/workspaces/[workspaceId]
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const workspace = poolManagerState.getWorkspace(workspaceId);

    if (!workspace) {
      return NextResponse.json(
        { success: false, error: "Workspace not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      workspace,
    });
  } catch (error) {
    console.error("Mock Pool Manager get workspace error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to get workspace" },
      { status: 500 }
    );
  }
}