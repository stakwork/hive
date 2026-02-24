import { NextRequest, NextResponse } from "next/server";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { CreateStakworkRunSchema } from "@/types/stakwork";
import { createStakworkRun } from "@/services/stakwork-run";

export const runtime = "nodejs";
export const fetchCache = "force-no-store";

/**
 * POST /api/stakwork/ai/generate
 * Create a new AI generation run via Stakwork
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userOrResponse = await requireAuthOrApiToken(request, body.workspaceId);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const userId = userOrResponse.id;

    const validationResult = CreateStakworkRunSchema.safeParse(body);

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

    // Create the Stakwork run
    const run = await createStakworkRun(input, userId);

    return NextResponse.json(
      {
        success: true,
        run: {
          id: run.id,
          type: run.type,
          status: run.status,
          workspaceId: run.workspaceId,
          featureId: run.featureId,
          webhookUrl: run.webhookUrl,
          projectId: run.projectId,
          createdAt: run.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating AI generation run:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Failed to create AI generation run";

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
