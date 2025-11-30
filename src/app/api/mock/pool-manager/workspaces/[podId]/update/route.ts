import { NextRequest, NextResponse } from "next/server";
import { poolManagerState } from "../../../state";

/**
 * POST /api/mock/pool-manager/workspaces/[podId]/update
 * Mock endpoint to update pod repositories
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ podId: string }> }
) {
  try {
    const { podId } = await params;
    const body = await request.json();

    console.log(`🎭 [Mock Pool Manager] Updating pod repositories: ${podId}`);

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

    if (body.repositories && Array.isArray(body.repositories)) {
      poolManagerState.updatePodRepositories(podId, body.repositories);
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    return NextResponse.json(
      {
        success: true,
        message: "Workspace updated successfully",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("❌ [Mock Pool Manager] Error updating pod:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to update workspace",
      },
      { status: 500 }
    );
  }
}