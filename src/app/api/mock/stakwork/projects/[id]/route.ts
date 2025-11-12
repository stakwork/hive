import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";

export const runtime = "nodejs";

/**
 * Mock endpoint for Stakwork project details API
 * GET /projects/{id}.json - Get project workflow data
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const projectId = params.id;
    console.log("[Mock Stakwork] Getting workflow data for project:", projectId);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 400 + 100));

    // Generate random workflow state
    const workflowStates = ["created", "in_progress", "review", "completed", "paid", "cancelled"];
    const randomState = workflowStates[Math.floor(Math.random() * workflowStates.length)];

    const mockWorkflowData = {
      transitions: [
        {
          id: 1,
          from_state: "created",
          to_state: "in_progress",
          action: "start_work",
        },
        {
          id: 2,
          from_state: "in_progress",
          to_state: "completed",
          action: "finish_work",
        },
        {
          id: 3,
          from_state: "completed",
          to_state: "paid",
          action: "process_payment",
        },
      ],
      connections: [
        {
          id: 1,
          source_id: projectId,
          target_id: "workflow-1",
          connection_type: "project_workflow",
        },
      ],
      project: {
        id: projectId,
        workflow_state: randomState,
        last_updated: new Date().toISOString(),
      },
    };

    const response = {
      success: true,
      data: mockWorkflowData,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error in mock Stakwork project details:", error);
    return NextResponse.json({ error: "Failed to get project details" }, { status: 500 });
  }
}