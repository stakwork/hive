import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/nextauth";
import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";
import type { ThinkingArtifact } from "@/types/stakwork";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { runId } = await params;

    // Fetch run with workspace validation
    const run = await db.stakworkRun.findUnique({
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

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // Verify workspace access
    if (run.workspace.members.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // If run has stored artifacts, return them
    if (run.thinkingArtifacts) {
      return NextResponse.json({
        runId: run.id,
        artifacts: run.thinkingArtifacts as unknown as ThinkingArtifact[],
      });
    }

    // If run has projectId, fetch workflow data from Stakwork
    if (run.projectId) {
      try {
        const response = await stakworkService().getWorkflowData(
          run.projectId.toString()
        );

        // Extract transitions from workflow response
        const data = response.workflowData as { transitions?: unknown[] };
        const transitions = data.transitions || [];
        const artifacts: ThinkingArtifact[] = transitions.map(
          (transition: unknown) => {
            const t = transition as {
              id: string;
              title: string;
              status: string;
              position?: number;
            };
            return {
              stepId: t.id,
              stepName: t.title,
              status: mapTransitionStatus(t.status),
              timestamp: new Date().toISOString(),
              details: t.position?.toString(),
            };
          }
        );

        return NextResponse.json({
          runId: run.id,
          artifacts,
        });
      } catch (error) {
        console.error("Error fetching workflow data:", error);
        // Return empty artifacts if workflow data fetch fails
        return NextResponse.json({
          runId: run.id,
          artifacts: [],
        });
      }
    }

    // Return empty artifacts if no projectId
    return NextResponse.json({
      runId: run.id,
      artifacts: [],
    });
  } catch (error) {
    console.error("Error fetching thinking artifacts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function mapTransitionStatus(
  status: string
): "pending" | "in_progress" | "completed" | "failed" {
  const normalized = status.toLowerCase();
  if (normalized.includes("complete") || normalized.includes("done")) {
    return "completed";
  }
  if (normalized.includes("progress") || normalized.includes("running")) {
    return "in_progress";
  }
  if (normalized.includes("fail") || normalized.includes("error")) {
    return "failed";
  }
  return "pending";
}
