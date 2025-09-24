import { db } from "@/lib/db";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { stakgraphToRepositoryStatus } from "@/utils/conversions";
import { WebhookPayload } from "@/types";

export async function updateStakgraphStatus(
  swarm: { id: string; workspaceId: string; repositoryUrl: string | null },
  payload: WebhookPayload,
): Promise<void> {
  const repositoryStatus = stakgraphToRepositoryStatus(payload.status);

  await Promise.all([
    saveOrUpdateSwarm({
      workspaceId: swarm.workspaceId,
      ingestRefId: payload.request_id,
    }),

    swarm.repositoryUrl && (payload.status === "COMPLETED" || payload.status === "FAILED")
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
