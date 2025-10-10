import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { createTicket } from "@/services/roadmap";
import type { CreateTicketRequest, TicketResponse } from "@/types/roadmap";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
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

    const { featureId } = await params;
    const body: CreateTicketRequest = await request.json();

    const ticket = await createTicket(featureId, userId, body);

    return NextResponse.json<TicketResponse>(
      {
        success: true,
        data: ticket,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating ticket:", error);
    const message = error instanceof Error ? error.message : "Failed to create ticket";
    const status = message.includes("not found") ? 404 :
                   message.includes("denied") ? 403 :
                   message.includes("required") || message.includes("Invalid") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
