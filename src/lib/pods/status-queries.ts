import { db } from "@/lib/db";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import type { PoolStatus } from "@/types/pool-manager";

/**
 * Get pool status by querying the pods table directly
 * Filters out soft-deleted pods and transitional states (TERMINATING, MOTHBALLED)
 * Uses a single query with in-memory aggregation for optimal performance
 */
export async function getPoolStatusFromPods(
  swarmId: string
): Promise<PoolStatus> {
  const baseFilter = {
    swarmId,
    deletedAt: null,
    status: {
      notIn: [PodStatus.TERMINATING, PodStatus.MOTHBALLED],
    },
  };

  // Fetch all pods matching the base filter in a single query
  const pods = await db.pod.findMany({
    where: baseFilter,
    select: {
      status: true,
      usageStatus: true,
      updatedAt: true,
    },
  });

  // Aggregate counts in-memory (more efficient than 5-6 separate DB queries)
  let runningVms = 0;
  let pendingVms = 0;
  let failedVms = 0;
  let usedVms = 0;
  let unusedVms = 0;
  let mostRecentUpdate = new Date(0); // Epoch time as starting point

  for (const pod of pods) {
    // Count by status
    if (pod.status === PodStatus.RUNNING) {
      runningVms++;
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

    // Count by usage status
    if (pod.usageStatus === PodUsageStatus.USED) {
      usedVms++;
    } else if (pod.usageStatus === PodUsageStatus.UNUSED) {
      unusedVms++;
    }

    // Track most recent update
    if (pod.updatedAt > mostRecentUpdate) {
      mostRecentUpdate = pod.updatedAt;
    }
  }

  // Use most recent pod's updatedAt, or current timestamp if no pods exist
  const lastCheck =
    mostRecentUpdate.getTime() > 0
      ? mostRecentUpdate.toISOString()
      : new Date().toISOString();

  return {
    runningVms,
    pendingVms,
    failedVms,
    usedVms,
    unusedVms,
    lastCheck,
  };
}
