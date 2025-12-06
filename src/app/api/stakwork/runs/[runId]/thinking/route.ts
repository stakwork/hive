import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    // Authenticate user
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { runId } = await params;

    // Fetch the stakwork run
    const stakworkRun = await db.stakworkRun.findUnique({
      where: { id: runId },
      include: {
        workspace: {
          include: {
            members: {
              where: { userId: session.user.id },
            },
          },
        },
      },
    });

    if (!stakworkRun) {
      return NextResponse.json(
        { error: "Stakwork run not found" },
        { status: 404 }
      );
    }

    // Verify user has access to the workspace
    if (stakworkRun.workspace.members.length === 0) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }

    // Return stored thinking artifacts if available
    if (stakworkRun.thinkingArtifacts) {
      return NextResponse.json({ artifacts: stakworkRun.thinkingArtifacts });
    }

    // Fetch workflow data from Stakwork API
    const workflowDataResponse = await stakworkService().getWorkflowData(
      stakworkRun.projectId?.toString() || ""
    );

    if (!workflowDataResponse?.workflowData) {
      return NextResponse.json(
        { error: "Workflow data not found" },
        { status: 404 }
      );
    }

    const workflowData = workflowDataResponse.workflowData as any;

    // Extract transitions from workflow data
    const transitions = workflowData.transitions || [];

    // Format thinking artifacts
    const artifacts = transitions
      .filter((t: any) => t.log || t.output || t.step_state)
      .map((t: any) => ({
        stepId: t.step_id || t.id,
        stepName: t.step_name || t.name,
        log: t.log,
        output: t.output,
        stepState: t.step_state || t.state,
      }));

    return NextResponse.json({ artifacts });
  } catch (error) {
    console.error("Error fetching thinking artifacts:", error);
    return NextResponse.json(
      { error: "Failed to fetch thinking artifacts" },
      { status: 500 }
    );
  }
}
