import { db } from "@/lib/db";
import { config } from "@/config/env";
import { EncryptionService } from "@/lib/encryption";

const encryptionService = EncryptionService.getInstance();

export interface PodScalerResult {
  success: boolean;
  swarmsProcessed: number;
  swarmsScaled: number;
  errors: Array<{ swarmId: string; error: string }>;
  timestamp: string;
}

/**
 * Auto-scaler cron: scales minimum_vms up/down based on over-queued task demand.
 * Runs every 5 minutes via /api/cron/pod-scaler.
 *
 * - Over-queued tasks: TODO + TASK_COORDINATOR, not deleted/archived, createdAt > 5 min ago
 * - Scale up:   minimum_vms = max(minimumPods, overQueuedCount + 2), capped at 20
 * - Scale down: minimum_vms = minimumPods
 * - minimumPods is never mutated by this cron.
 * - Hard ceiling: targetVms is always capped at 20 pods maximum.
 */
export async function executePodScalerRuns(): Promise<PodScalerResult> {
  const timestamp = new Date().toISOString();
  const errors: Array<{ swarmId: string; error: string }> = [];
  let swarmsProcessed = 0;
  let swarmsScaled = 0;

  const swarms = await db.swarm.findMany({
    where: { poolApiKey: { not: null } },
    select: {
      id: true,
      minimumVms: true,
      minimumPods: true,
      deployedPods: true,
      poolApiKey: true,
      workspaceId: true,
    },
  });

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  for (const swarm of swarms) {
    swarmsProcessed++;

    try {
      const overQueuedCount = await db.task.count({
        where: {
          workspaceId: swarm.workspaceId,
          status: "TODO",
          systemAssigneeType: "TASK_COORDINATOR",
          deleted: false,
          archived: false,
          sourceType: { not: "USER_JOURNEY" },
          OR: [
            { featureId: null },
            { feature: { status: { not: "CANCELLED" } } },
          ],
          createdAt: { lt: fiveMinutesAgo },
        },
      });

      const floor = swarm.minimumPods ?? swarm.minimumVms;
      const targetVms = Math.min(
        overQueuedCount > 0
          ? Math.max(floor, overQueuedCount + 2)
          : floor,
        20
      );

      // Always record the check result in deployedPods
      await db.swarm.update({
        where: { id: swarm.id },
        data: { minimumVms: targetVms, deployedPods: targetVms },
      });

      if (targetVms !== swarm.minimumVms) {
        swarmsScaled++;
        const decryptedKey = encryptionService.decryptField(
          "poolApiKey",
          swarm.poolApiKey!
        );
        const scaleUrl = `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(swarm.id)}/scale`;
        const response = await fetch(scaleUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${decryptedKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ minimum_vms: targetVms }),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            `Pool Manager scale failed (${response.status}): ${text}`
          );
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ swarmId: swarm.id, error: message });
    }
  }

  return {
    success: errors.length === 0,
    swarmsProcessed,
    swarmsScaled,
    errors,
    timestamp,
  };
}
