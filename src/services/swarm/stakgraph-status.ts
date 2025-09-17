import { db } from "@/lib/db";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { stakgraphToStepStatus, stakgraphToRepositoryStatus } from "@/utils/conversions";
import { WebhookPayload } from "@/types";

export async function updateStakgraphStatus(
  swarm: { id: string; workspaceId: string; repositoryUrl: string | null },
  payload: WebhookPayload,
  requestIdHeader?: string | null,
): Promise<void> {
  const stepStatus = stakgraphToStepStatus(payload.status);
  const repositoryStatus = stakgraphToRepositoryStatus(payload.status);

  const stakgraphData = {
    requestId: payload.request_id,
    requestIdHeader,
    status: payload.status,
    progress: payload.progress,
    nodes: payload.result?.nodes,
    edges: payload.result?.edges,
    error: payload.error,
    startedAt: payload.started_at,
    completedAt: payload.completed_at,
    durationMs: payload.duration_ms,
    lastUpdateAt: new Date().toISOString(),
  };

  await Promise.all([
    saveOrUpdateSwarm({
      workspaceId: swarm.workspaceId,
      stepStatus,
      wizardData: { stakgraph: stakgraphData },
      ingestRefId: payload.request_id,
    }),

    swarm.repositoryUrl && (stepStatus === "COMPLETED" || stepStatus === "FAILED")
      ? db.repository.update({
          where: {
            repositoryUrl_workspaceId: {
              repositoryUrl: swarm.repositoryUrl,
              workspaceId: swarm.workspaceId,
            },
          },
          data: { status: repositoryStatus },
        })
      : Promise.resolve(),
  ]);
}
