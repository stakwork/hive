import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getTicket, updateTicket, deleteTicket } from "@/services/roadmap";
import type { UpdateTicketRequest, TicketResponse, TicketDetail } from "@/types/roadmap";
import type { ApiSuccessResponse } from "@/types/common";

export async function GET(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { ticketId } = await params;

    const ticket = await getTicket(ticketId, userOrResponse.id);

    return NextResponse.json<ApiSuccessResponse<TicketDetail>>(
      {
        success: true,
        data: ticket,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching ticket:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch ticket";
    const status = message.includes("not found") ? 404 : message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { ticketId } = await params;
    const body: UpdateTicketRequest = await request.json();

    const ticket = await updateTicket(ticketId, userOrResponse.id, body);

    return NextResponse.json<TicketResponse>(
      {
        success: true,
        data: ticket,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error updating ticket:", error);
    const message = error instanceof Error ? error.message : "Failed to update ticket";
    const status = message.includes("not found")
      ? 404
      : message.includes("denied")
        ? 403
        : message.includes("cannot be empty") ||
            message.includes("Invalid") ||
            message.includes("must be") ||
            message.includes("Circular dependency") ||
            message.includes("cannot depend on itself")
          ? 400
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { ticketId } = await params;

    await deleteTicket(ticketId, userOrResponse.id);

    return NextResponse.json(
      {
        success: true,
        message: "Ticket deleted successfully",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error deleting ticket:", error);
    const message = error instanceof Error ? error.message : "Failed to delete ticket";
    const status = message.includes("not found") ? 404 : message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
