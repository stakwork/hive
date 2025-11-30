import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../state";

/**
 * GET /api/mock/pool-manager/workspaces/[podId]
 * Mock endpoint to get a specific workspace/pod
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ podId: string }> }
) {
  try {
    const { podId } = await params;

    console.log(`🎭 [Mock Pool Manager] Getting workspace: ${podId}`);

    const pod = poolManagerState.getPod(podId);

    if (!pod) {
      return NextResponse.json(
        {
          success: false,
          error: "Workspace not found",
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        workspace: pod,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ [Mock Pool Manager] Error getting workspace:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get workspace",
      },
      { status: 500 }
    );
  }
}