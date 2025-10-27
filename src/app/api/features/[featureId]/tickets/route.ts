import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext } from "@/lib/middleware/utils";
import { requireAuthWithApiToken } from "@/lib/middleware/auth-helpers";
import { createTicket } from "@/services/roadmap";
import type { CreateTicketRequest, TicketResponse } from "@/types/roadmap";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const { featureId } = await params;
    const body: CreateTicketRequest = await request.json();

    const context = getMiddlewareContext(request);
    const authResult = await requireAuthWithApiToken(request, context, {
      featureId,
    });
    if (authResult instanceof NextResponse) return authResult;

    const ticket = await createTicket(featureId, authResult.userId, body);

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
