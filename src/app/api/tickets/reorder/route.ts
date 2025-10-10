import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { reorderTickets } from "@/services/roadmap";
import type { ReorderTicketsRequest, TicketListResponse } from "@/types/roadmap";

export async function POST(request: NextRequest) {
  try {
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

    const body: ReorderTicketsRequest = await request.json();

    const tickets = await reorderTickets(userId, body.tickets);

    return NextResponse.json<TicketListResponse>(
      {
        success: true,
        data: tickets,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error reordering tickets:", error);
    const message = error instanceof Error ? error.message : "Failed to reorder tickets";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 :
                   message.includes("array") || message.includes("empty") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
