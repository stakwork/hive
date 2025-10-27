import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { UpdateStakworkRunDecisionSchema } from "@/types/stakwork";
import { updateStakworkRunDecision } from "@/services/stakwork-run";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * PATCH /api/ai/runs/[runId]/decision
 * Update user decision (accept/reject/feedback) on an AI generation run
 * For ARCHITECTURE type + ACCEPTED: also updates feature.architecture
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    // Authenticate user
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as { id?: string })?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Invalid user session" },
        { status: 401 }
      );
    }

    const { runId } = await params;

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
