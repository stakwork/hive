import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { batchCreatePhasesWithTickets } from "@/services/roadmap";
import type { BatchCreatePhasesRequest, BatchCreatePhasesResponse } from "@/types/roadmap";

export async function POST(request: NextRequest, { params }: { params: Promise<{ featureId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;
    const body: BatchCreatePhasesRequest = await request.json();

    if (!body.phases || !Array.isArray(body.phases)) {
      return NextResponse.json({ error: "Phases array is required" }, { status: 400 });
    }

    if (body.phases.length === 0) {
      return NextResponse.json({ error: "Phases array cannot be empty" }, { status: 400 });
    }

    const result = await batchCreatePhasesWithTickets(featureId, userOrResponse.id, body.phases);

    return NextResponse.json<BatchCreatePhasesResponse>(
      {
        success: true,
        data: result,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error batch creating phases and tickets:", error);
    const message = error instanceof Error ? error.message : "Failed to batch create phases and tickets";
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
