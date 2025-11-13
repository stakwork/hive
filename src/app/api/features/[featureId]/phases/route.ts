import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext } from "@/lib/middleware/utils";
import { requireAuthWithApiToken } from "@/lib/middleware/auth-helpers";
import { createPhase } from "@/services/roadmap";
import type { CreatePhaseRequest, PhaseResponse } from "@/types/roadmap";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const { featureId } = await params;
    const body: CreatePhaseRequest = await request.json();

    const context = getMiddlewareContext(request);
    const authResult = await requireAuthWithApiToken(request, context, {
      featureId,
    });
    if (authResult instanceof NextResponse) return authResult;

    const phase = await createPhase(featureId, authResult.userId, body);

    return NextResponse.json<PhaseResponse>(
      {
        success: true,
        data: phase,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating phase:", error);
    const message = error instanceof Error ? error.message : "Failed to create phase";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 :
                   message.includes("required") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
