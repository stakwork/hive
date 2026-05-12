import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getTicket, updateTicket, deleteTicket } from "@/services/roadmap";
import type { UpdateTicketRequest, TicketResponse, TicketDetail } from "@/types/roadmap";
import type { ApiSuccessResponse } from "@/types/common";
import { db } from "@/lib/db";
import { resolveWorkspaceAccess, isPublicViewer } from "@/lib/auth/workspace-access";
import { toPublicUser } from "@/lib/auth/public-redact";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
  try {
    const { ticketId } = await params;

    // Resolve ticket → workspace so we can run the standard access check.
    const ticketMeta = await db.task.findUnique({
      where: { id: ticketId },
      select: { workspaceId: true, deleted: true },
    });
    if (!ticketMeta || ticketMeta.deleted) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    let userIdForService: string | null = null;
    let redactForPublic = false;

    if (userOrResponse instanceof NextResponse) {
      const access = await resolveWorkspaceAccess(request, {
        workspaceId: ticketMeta.workspaceId,
      });
      if (!access || access.kind !== "public-viewer") return userOrResponse;
      redactForPublic = isPublicViewer(access);
    } else {
      userIdForService = userOrResponse.id;
    }

    const ticket = await getTicket(ticketId, userIdForService);

    const sanitized = redactForPublic
      ? {
          ...ticket,
          assignee: toPublicUser((ticket as unknown as { assignee?: unknown }).assignee as Parameters<typeof toPublicUser>[0]),
        }
      : ticket;

    return NextResponse.json<ApiSuccessResponse<TicketDetail>>(
      {
        success: true,
        data: sanitized as TicketDetail,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error fetching ticket:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch ticket";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
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
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating ticket:", error);
    const message = error instanceof Error ? error.message : "Failed to update ticket";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 :
                   message.includes("cannot be empty") ||
                   message.includes("Invalid") ||
                   message.includes("must be") ||
                   message.includes("Circular dependency") ||
                   message.includes("cannot depend on itself") ||
                   message.includes("mutually exclusive") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ticketId: string }> }
) {
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
      { status: 200 }
    );
  } catch (error) {
    console.error("Error deleting ticket:", error);
    const message = error instanceof Error ? error.message : "Failed to delete ticket";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
