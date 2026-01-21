import { db } from "@/lib/db";
import { getAllRepositories } from "@/lib/helpers/repository";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { stakgraphToRepositoryStatus } from "@/utils/conversions";
import { WebhookPayload } from "@/types";

export async function updateStakgraphStatus(
  swarm: { id: string; workspaceId: string },
  payload: WebhookPayload,
  repositoryId?: string,
): Promise<void> {
  const repositoryStatus = stakgraphToRepositoryStatus(payload.status);

  // Get repositories to update based on repositoryId parameter
  let repositoriesToUpdate: Array<{ id: string; repositoryUrl: string }>;
  
  if (repositoryId) {
    // Update specific repository only
    const repository = await db.repository.findUnique({
      where: { id: repositoryId },
      select: { id: true, repositoryUrl: true, workspaceId: true },
    });

    if (!repository || repository.workspaceId !== swarm.workspaceId) {
      console.warn(`[updateStakgraphStatus] Repository ${repositoryId} not found or doesn't belong to workspace ${swarm.workspaceId}`);
      repositoriesToUpdate = [];
    } else {
      repositoriesToUpdate = [repository];
    }
  } else {
    // Update all repositories in the workspace
    const allRepositories = await getAllRepositories(swarm.workspaceId);
    repositoriesToUpdate = allRepositories.map(repo => ({ 
      id: repo.id, 
      repositoryUrl: repo.repositoryUrl 
    }));
  }

  console.log(`[updateStakgraphStatus] Updating status for ${repositoriesToUpdate.length} repository/repositories to ${repositoryStatus}`);

  await Promise.all([
    saveOrUpdateSwarm({
      workspaceId: swarm.workspaceId,
      ingestRefId: payload.request_id,
    }),

    ...repositoriesToUpdate.map(repo =>
      db.repository.update({
        where: {
          repositoryUrl_workspaceId: {
            repositoryUrl: repo.repositoryUrl,
            workspaceId: swarm.workspaceId,
          },
        },
        data: { status: repositoryStatus, updatedAt: new Date() },
      })
    ),
  ]);
}
