import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import { UpdateStakworkRunDecisionSchema } from "@/types/stakwork";
import { updateStakworkRunDecision } from "@/services/stakwork-run";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * PATCH /api/stakwork/runs/[runId]/decision
 * Update user decision (accept/reject/feedback) on an AI generation run
 * For ARCHITECTURE type + ACCEPTED: also updates feature.architecture
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    // Look up the run to get workspaceId for API token auth
    const runLookup = await db.stakworkRun.findUnique({
      where: { id: runId },
      select: { workspaceId: true },
    });
    const userOrResponse = await requireAuthOrApiToken(request, runLookup?.workspaceId);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const userId = userOrResponse.id;

    if (!runId) {
      return NextResponse.json(
        { error: "runId is required" },
        { status: 400 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validationResult = UpdateStakworkRunDecisionSchema.safeParse(body);

    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: validationResult.error.format(),
        },
        { status: 400 }
      );
    }

    const input = validationResult.data;

    // Validate featureId is provided when decision is ACCEPTED
    if (input.decision === "ACCEPTED" && !input.featureId) {
      return NextResponse.json(
        {
          error: "featureId is required when accepting a decision",
        },
        { status: 400 }
      );
    }

    // Update the decision
    const updatedRun = await updateStakworkRunDecision(runId, userId, input);

    return NextResponse.json(
      {
        success: true,
        run: {
          id: updatedRun.id,
          type: updatedRun.type,
          status: updatedRun.status,
          decision: updatedRun.decision,
          feedback: updatedRun.feedback,
          featureId: updatedRun.featureId,
          updatedAt: updatedRun.updatedAt,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating decision:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Failed to update decision";

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
