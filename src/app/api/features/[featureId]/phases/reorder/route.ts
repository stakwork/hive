import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/middleware/utils";
import { reorderPhases } from "@/services/roadmap";
import type { ReorderPhasesRequest, PhaseListResponse } from "@/types/roadmap";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const userId = getUserId(request);

    const { featureId } = await params;
    const body: ReorderPhasesRequest = await request.json();

    const phases = await reorderPhases(featureId, userId, body.phases);

    return NextResponse.json<PhaseListResponse>(
      {
        success: true,
        data: phases,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error reordering phases:", error);
    const message = error instanceof Error ? error.message : "Failed to reorder phases";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 :
                   message.includes("array") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
