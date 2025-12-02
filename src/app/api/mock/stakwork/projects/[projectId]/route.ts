import { NextRequest, NextResponse } from "next/server";
import { mockStakworkState } from "@/lib/mock/stakwork-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    let { projectId } = await params;
    // Strip .json suffix if present (app calls /projects/123.json)
    if (projectId.endsWith(".json")) {
      projectId = projectId.slice(0, -5);
    }
    const project = mockStakworkState.getProject(parseInt(projectId));

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        transitions: project.transitions,
        connections: project.connections,
        project: {
          workflow_state: project.workflow_state,
          name: project.name,
          workflow_id: project.workflow_id,
        },
      },
    });
  } catch (error) {
    console.error("Mock Stakwork get workflow error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}