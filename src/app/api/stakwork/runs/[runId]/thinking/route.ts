import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/nextauth';
import { db } from '@/lib/db';
import { ServiceFactory } from '@/lib/service-factory';
import type { ThinkingArtifact } from '@/types/thinking';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { runId } = await params;

    // Fetch the run from database
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
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    // Check workspace access
    if (!run.workspace?.members?.length) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // If no projectId, return empty artifacts
    if (!run.projectId) {
      return NextResponse.json({ artifacts: [], runId });
    }

    // Fetch workflow data from Stakwork
    const stakworkService = ServiceFactory.getStakworkService();
    const workflowData = await stakworkService.getWorkflowData(run.projectId.toString());

    // Extract thinking artifacts from transitions
    const artifacts: ThinkingArtifact[] = [];
    
    if (workflowData.workflowData && typeof workflowData.workflowData === 'object' && 'data' in workflowData.workflowData) {
      const data = workflowData.workflowData as any;
      if (data.data?.transitions) {
        for (const transition of data.data.transitions) {
          const artifact: ThinkingArtifact = {
            stepId: transition.id || `step-${artifacts.length}`,
            stepName: transition.name || transition.step_name || 'Unnamed Step',
          };

          // Only include fields with content
          if (transition.log) {
            artifact.log = transition.log;
          }
          if (transition.output) {
            artifact.output = transition.output;
          }
          if (transition.step_state) {
            artifact.stepState = transition.step_state as ThinkingArtifact['stepState'];
          }

          artifacts.push(artifact);
        }
      }
    }

    return NextResponse.json({
      artifacts,
      runId,
      projectId: run.projectId,
    });
  } catch (error) {
    console.error('Error fetching thinking artifacts:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
