import { NextRequest, NextResponse } from "next/server";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { createTicket } from "@/services/roadmap";
import type { CreateTicketRequest, TicketResponse } from "@/types/roadmap";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ featureId: string }> }
) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { featureId } = await params;
    const body: CreateTicketRequest = await request.json();

    const ticket = await createTicket(featureId, userOrResponse.id, body);

    // Auto-mark pending TASK_GENERATION run as ACCEPTED when user manually creates a task
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
      // Get workspaceId from the ticket's workspace relation
      const workspaceId = ticket.workspaceId;
      
      const pendingRunResponse = await fetch(
        `${baseUrl}/api/stakwork/runs?workspaceId=${workspaceId}&featureId=${featureId}&type=TASK_GENERATION&status=COMPLETED`
      );
      
      if (pendingRunResponse.ok) {
        const runsData = await pendingRunResponse.json();
        const pendingRun = runsData.runs?.find((r: any) => r.decision === null);
        
        if (pendingRun?.id) {
          await fetch(`${baseUrl}/api/stakwork/runs/${pendingRun.id}/decision`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ decision: "ACCEPTED", featureId }),
          });
        }
      }
    } catch (error) {
      // Log but don't fail the request if marking run as ACCEPTED fails
      console.error("Failed to mark TASK_GENERATION run as ACCEPTED:", error);
    }

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
