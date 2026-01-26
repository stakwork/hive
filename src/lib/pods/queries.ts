/**
 * Pod Query Helper Functions
 *
 * Reusable helper functions for querying pods with automatic soft-delete filtering.
 * All read functions explicitly filter out soft-deleted pods (deletedAt IS NULL).
 */

import { db } from "@/lib/db";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import type { Pod } from "@prisma/client";

/**
 * Find all non-deleted pods for a swarm
 * @param swarmId - The swarm ID to query
 * @returns Array of active (non-deleted) pods
 */
export async function findActivePods(swarmId: string): Promise<Pod[]> {
  return db.pod.findMany({
    where: {
      swarmId,
      deletedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Find all unused, non-deleted pods for a swarm
 * @param swarmId - The swarm ID to query
 * @returns Array of unused pods (usageStatus = UNUSED)
 */
export async function findUnusedPods(swarmId: string): Promise<Pod[]> {
  return db.pod.findMany({
    where: {
      swarmId,
      usageStatus: PodUsageStatus.UNUSED,
      deletedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Find all used, non-deleted pods for a swarm
 * @param swarmId - The swarm ID to query
 * @returns Array of used pods (usageStatus = USED)
 */
export async function findUsedPods(swarmId: string): Promise<Pod[]> {
  return db.pod.findMany({
    where: {
      swarmId,
      usageStatus: PodUsageStatus.USED,
      deletedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Find pods ready to be claimed (RUNNING status, UNUSED, non-deleted)
 * Excludes transitional states: STARTING, CREATING, PENDING, MOTHBALLED, CRASHING, UNSTABLE, FAILED, STOPPED, TERMINATING
 * @param swarmId - The swarm ID to query
 * @returns Array of claimable pods
 */
export async function findClaimablePods(swarmId: string): Promise<Pod[]> {
  return db.pod.findMany({
    where: {
      swarmId,
      status: PodStatus.RUNNING,
      usageStatus: PodUsageStatus.UNUSED,
      deletedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Find pods by specific status (excluding soft-deleted)
 * @param swarmId - The swarm ID to query
 * @param status - The pod status to filter by
 * @returns Array of pods with the specified status
 */
export async function findPodsByStatus(
  swarmId: string,
  status: PodStatus
): Promise<Pod[]> {
  return db.pod.findMany({
    where: {
      swarmId,
      status,
      deletedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Soft-delete a pod by setting its deletedAt timestamp
 * @param podId - The pod ID to soft-delete
 * @returns The updated pod record
 */
export async function softDeletePod(podId: string): Promise<Pod> {
  return db.pod.update({
    where: {
      id: podId,
    },
    data: {
      deletedAt: new Date(),
    },
  });
}

/**
 * Find soft-deleted pods for a swarm (for admin/audit purposes)
 * @param swarmId - The swarm ID to query
 * @returns Array of soft-deleted pods
 */
export async function findDeletedPods(swarmId: string): Promise<Pod[]> {
  return db.pod.findMany({
    where: {
      swarmId,
      deletedAt: {
        not: null,
      },
    },
    orderBy: {
      deletedAt: "desc",
    },
  });
}
