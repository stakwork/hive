import { db } from "@/lib/db";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { stakgraphToRepositoryStatus } from "@/utils/conversions";
import { WebhookPayload } from "@/types";

export async function updateStakgraphStatus(
  swarm: { id: string; workspaceId: string },
  payload: WebhookPayload,
): Promise<void> {
  const repositoryStatus = stakgraphToRepositoryStatus(payload.status);

  const primaryRepo = await getPrimaryRepository(swarm.workspaceId);

  await Promise.all([
    saveOrUpdateSwarm({
      workspaceId: swarm.workspaceId,
      ingestRefId: payload.request_id,
    }),

    primaryRepo
      ? db.repository.update({
          where: {
            repositoryUrl_workspaceId: {
              repositoryUrl: primaryRepo.repositoryUrl,
              workspaceId: swarm.workspaceId,
            },
          },
          data: { status: repositoryStatus, updatedAt: new Date() },
        })
      : Promise.resolve(),
  ]);
}
