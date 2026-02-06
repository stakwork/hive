import { db } from "@/lib/db";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import type { PoolStatus } from "@/types/pool-manager";

/**
 * Get pool status by aggregating pod counts from the pods table
 * @param swarmId - The swarm ID to filter pods by
 * @returns PoolStatus object with pod counts and last update timestamp
 */
export async function getPoolStatusFromPods(
  swarmId: string
): Promise<PoolStatus> {
  // Define which statuses belong to each category
  const pendingStatuses: PodStatus[] = [
    PodStatus.PENDING,
    PodStatus.STARTING,
    PodStatus.CREATING,
  ];

  const failedStatuses: PodStatus[] = [
    PodStatus.FAILED,
    PodStatus.STOPPED,
    PodStatus.CRASHING,
    PodStatus.UNSTABLE,
  ];

  // Statuses to exclude from all counts
  const excludedStatuses: PodStatus[] = [
    PodStatus.TERMINATING,
    PodStatus.MOTHBALLED,
  ];

  // Base filter: swarmId match, not soft-deleted, not in transitional states
  const baseWhere = {
    swarmId,
    deletedAt: null,
    status: {
      notIn: excludedStatuses,
    },
  };

  // Execute all counts in parallel for better performance
  const [runningVms, pendingVms, failedVms, usedVms, unusedVms, mostRecentPod] =
    await Promise.all([
      // Count RUNNING pods
      db.pod.count({
        where: {
          ...baseWhere,
          status: PodStatus.RUNNING,
        },
      }),

      // Count PENDING/STARTING/CREATING pods
      db.pod.count({
        where: {
          ...baseWhere,
          status: {
            in: pendingStatuses,
          },
        },
      }),

      // Count FAILED/STOPPED/CRASHING/UNSTABLE pods
      db.pod.count({
        where: {
          ...baseWhere,
          status: {
            in: failedStatuses,
          },
        },
      }),

      // Count USED pods
      db.pod.count({
        where: {
          ...baseWhere,
          usageStatus: PodUsageStatus.USED,
        },
      }),

      // Count UNUSED pods
      db.pod.count({
        where: {
          ...baseWhere,
          usageStatus: PodUsageStatus.UNUSED,
        },
      }),

      // Get most recent pod update timestamp
      db.pod.findFirst({
        where: baseWhere,
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          updatedAt: true,
        },
      }),
    ]);

  // Use most recent pod's updatedAt, or current timestamp if no pods exist
  const lastCheck = mostRecentPod?.updatedAt
    ? mostRecentPod.updatedAt.toISOString()
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
