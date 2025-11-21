import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { createPhase } from "@/services/roadmap";
import type { CreatePhaseRequest, PhaseResponse } from "@/types/roadmap";

export async function POST(request: NextRequest, { params }: { params: Promise<{ featureId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;
    const body: CreatePhaseRequest = await request.json();

    const phase = await createPhase(featureId, userOrResponse.id, body);

    return NextResponse.json<PhaseResponse>(
      {
        success: true,
        data: phase,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating phase:", error);
    const message = error instanceof Error ? error.message : "Failed to create phase";
    const status = message.includes("not found")
      ? 404
      : message.includes("denied")
        ? 403
        : message.includes("required")
          ? 400
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
