import { db } from "@/lib/db";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import type { PoolStatus } from "@/types/pool-manager";

/**
 * Get pool status by querying the pods table directly
 * Filters out soft-deleted pods and transitional states (TERMINATING, MOTHBALLED)
 * Uses a single query with in-memory aggregation for optimal performance
 */
export async function getPoolStatusFromPods(
  swarmId: string,
  workspaceId: string
): Promise<PoolStatus> {
  const baseFilter = {
    swarmId,
    deletedAt: null,
    status: {
      notIn: [PodStatus.TERMINATING, PodStatus.MOTHBALLED],
    },
  };

  // Fetch pods and queued task count in parallel
  const [pods, queuedCount] = await Promise.all([
    db.pod.findMany({
      where: baseFilter,
      select: {
        status: true,
        usageStatus: true,
        updatedAt: true,
      },
    }),
    db.task.count({
      where: {
        AND: [
          { workspaceId },
          { deleted: false },
          { status: "TODO" },
          { systemAssigneeType: "TASK_COORDINATOR" },
          { OR: [{ featureId: null }, { feature: { status: { not: "CANCELLED" } } }] },
        ],
      },
    }),
  ]);

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

    // Count by usage status (only RUNNING pods are truly available)
    if (pod.usageStatus === PodUsageStatus.USED && pod.status === PodStatus.RUNNING) {
      usedVms++;
    } else if (
      pod.usageStatus === PodUsageStatus.UNUSED &&
      pod.status === PodStatus.RUNNING
    ) {
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
    queuedCount,
  };
}
