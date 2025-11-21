import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getPhase, updatePhase, deletePhase } from "@/services/roadmap";
import type { UpdatePhaseRequest, PhaseResponse, PhaseWithTickets } from "@/types/roadmap";
import type { ApiSuccessResponse } from "@/types/common";

export async function GET(request: NextRequest, { params }: { params: Promise<{ phaseId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { phaseId } = await params;

    const phase = await getPhase(phaseId, userOrResponse.id);

    return NextResponse.json<ApiSuccessResponse<PhaseWithTickets>>(
      {
        success: true,
        data: phase,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching phase:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch phase";
    const status = message.includes("not found") ? 404 : message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ phaseId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { phaseId } = await params;
    const body: UpdatePhaseRequest = await request.json();

    const phase = await updatePhase(phaseId, userOrResponse.id, body);

    return NextResponse.json<PhaseResponse>(
      {
        success: true,
        data: phase,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error updating phase:", error);
    const message = error instanceof Error ? error.message : "Failed to update phase";
    const status = message.includes("not found")
      ? 404
      : message.includes("denied")
        ? 403
        : message.includes("cannot be empty") || message.includes("must be")
          ? 400
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ phaseId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { phaseId } = await params;

    await deletePhase(phaseId, userOrResponse.id);

    return NextResponse.json(
      {
        success: true,
        message: "Phase deleted successfully",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error deleting phase:", error);
    const message = error instanceof Error ? error.message : "Failed to delete phase";
    const status = message.includes("not found") ? 404 : message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
