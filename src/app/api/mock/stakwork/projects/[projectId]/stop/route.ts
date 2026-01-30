import { NextRequest, NextResponse } from "next/server";
import { mockStakworkState } from "@/lib/mock/stakwork-state";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const projectIdNum = parseInt(projectId);

    const project = mockStakworkState.getProject(projectIdNum);

    if (!project) {
      return NextResponse.json(
        { success: false, error: "Project not found" },
        { status: 404 }
      );
    }

    // Stop the workflow
    const stopped = mockStakworkState.stopWorkflow(projectIdNum);

    if (!stopped) {
      return NextResponse.json(
        { success: false, error: "Failed to stop workflow" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Workflow stopped",
    });
  } catch (error) {
    console.error("Mock Stakwork stop workflow error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
