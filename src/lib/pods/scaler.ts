import { db } from "@/lib/db";
import { config } from "@/config/env";
import { EncryptionService } from "@/lib/encryption";
import { PodStatus, PodUsageStatus } from "@prisma/client";

const encryptionService = EncryptionService.getInstance();

/** Hard ceiling on minimum_vms for externally-driven scaling. */
export const POD_SCALER_MAX_PODS = 20;

export interface PodUsage {
  usedVms: number;
  runningVms: number;
  pendingVms: number;
  failedVms: number;
  lastReleasedAt: string | null;
}

/**
 * Pod usage for a swarm. Same pod filter as getPoolStatusFromPods, but
 * deliberately performs no Task queries.
 */
export async function getPodUsage(swarmId: string): Promise<PodUsage> {
  const pods = await db.pod.findMany({
    where: {
      swarmId,
      deletedAt: null,
      podId: { not: { startsWith: "ws-pool-" } },
      status: { notIn: [PodStatus.TERMINATING, PodStatus.MOTHBALLED] },
    },
    select: { status: true, usageStatus: true, usageStatusMarkedAt: true },
  });

  let running = 0;
  let pendingVms = 0;
  let failedVms = 0;
  let usedVms = 0;
  let lastReleased: Date | null = null;

  for (const pod of pods) {
    if (pod.status === PodStatus.RUNNING) {
      running++;
      if (pod.usageStatus === PodUsageStatus.USED) usedVms++;
    } else if (
      pod.status === PodStatus.PENDING ||
      pod.status === PodStatus.STARTING ||
      pod.status === PodStatus.CREATING
    ) {
      pendingVms++;
    } else if (
      pod.status === PodStatus.FAILED ||
      pod.status === PodStatus.STOPPED ||
      pod.status === PodStatus.CRASHING ||
      pod.status === PodStatus.UNSTABLE
    ) {
      failedVms++;
    }

    if (
      pod.usageStatus === PodUsageStatus.UNUSED &&
      pod.usageStatusMarkedAt &&
      (!lastReleased || pod.usageStatusMarkedAt > lastReleased)
    ) {
      lastReleased = pod.usageStatusMarkedAt;
    }
  }

  return {
    usedVms,
    runningVms: running + pendingVms,
    pendingVms,
    failedVms,
    lastReleasedAt: lastReleased ? (lastReleased as Date).toISOString() : null,
  };
}

/** Persist the new minimum and tell Pool Manager. Throws on non-ok response. */
export async function applyPoolScale(
  swarm: { id: string; poolApiKey: string | null },
  target: number,
): Promise<void> {
  await db.swarm.update({
    where: { id: swarm.id },
    data: { minimumVms: target, deployedPods: target },
  });

  const decryptedKey = encryptionService.decryptField("poolApiKey", swarm.poolApiKey!);
  const response = await fetch(
    `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(swarm.id)}/scale`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${decryptedKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ minimum_vms: target }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Pool Manager scale failed (${response.status}): ${text}`);
  }
}
