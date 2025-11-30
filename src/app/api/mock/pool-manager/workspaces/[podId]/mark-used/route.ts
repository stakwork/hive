import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../../state";

/**
 * POST /api/mock/pool-manager/workspaces/[podId]/mark-used
 * Mock endpoint to mark a pod as in-use
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ podId: string }> }
) {
  try {
    const { podId } = await params;

    console.log(`🎭 [Mock Pool Manager] Marking pod as used: ${podId}`);

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
        message: "Workspace marked as used",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ [Mock Pool Manager] Error marking pod as used:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to mark workspace as used",
      },
      { status: 500 }
    );
  }
}