import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { reorderTickets } from "@/services/roadmap";
import type { ReorderTicketsRequest, TicketListResponse } from "@/types/roadmap";

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const body: ReorderTicketsRequest = await request.json();

    const tickets = await reorderTickets(userOrResponse.id, body.tasks);

    return NextResponse.json<TicketListResponse>(
      {
        success: true,
        data: tickets,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error reordering tickets:", error);
    const message = error instanceof Error ? error.message : "Failed to reorder tickets";
    const status = message.includes("not found")
      ? 404
      : message.includes("denied")
        ? 403
        : message.includes("array") || message.includes("empty")
          ? 400
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
