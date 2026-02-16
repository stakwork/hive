import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { stopStakworkRun } from "@/services/stakwork-run";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * POST /api/stakwork/runs/[runId]/stop
 * Stop an in-progress Deep Research run
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    // Authenticate user
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const userId = userOrResponse.id;

    const { runId } = await params;

    if (!runId) {
      return NextResponse.json(
        { error: "runId is required" },
        { status: 400 }
      );
    }

    // Stop the run
    const updatedRun = await stopStakworkRun(runId, userId);

    return NextResponse.json(
      {
        success: true,
        run: {
          id: updatedRun.id,
          status: updatedRun.status,
          updatedAt: updatedRun.updatedAt.toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error stopping run:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Failed to stop run";

    // Determine status code based on error message
    const status = errorMessage.includes("not found")
      ? 404
      : errorMessage.includes("Access denied")
        ? 403
        : errorMessage.includes("does not have a projectId")
          ? 400
          : 500;

    return NextResponse.json(
      { error: errorMessage },
      { status }
    );
  }
}
