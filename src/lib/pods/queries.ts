import { db } from "@/lib/db";
import { PodStatus, PodUsageStatus } from "@prisma/client";

/**
 * Find all active (non-deleted) pods for a swarm
 * Middleware automatically filters deletedAt: null
 */
export async function findActivePods(swarmId: string) {
  return db.pod.findMany({
    where: {
      swarmId,
    },
    orderBy: { id: "asc" },
  });
}

/**
 * Find all unused, non-deleted pods for a swarm
 * Middleware automatically filters deletedAt: null
 */
export async function findUnusedPods(swarmId: string) {
  return db.pod.findMany({
    where: {
      swarmId,
      usageStatus: PodUsageStatus.UNUSED,
    },
    orderBy: { id: "asc" },
  });
}

/**
 * Find all used, non-deleted pods for a swarm
 * Middleware automatically filters deletedAt: null
 */
export async function findUsedPods(swarmId: string) {
  return db.pod.findMany({
    where: {
      swarmId,
      usageStatus: PodUsageStatus.USED,
    },
    orderBy: { id: "asc" },
  });
}

/**
 * Find claimable pods for a swarm
 * Returns pods that are:
 * - In RUNNING status (excludes transitional states)
 * - Non-deleted (via middleware)
 * - Can optionally filter by usageStatus
 */
export async function findClaimablePods(swarmId: string) {
  return db.pod.findMany({
    where: {
      swarmId,
      status: PodStatus.RUNNING,
    },
    orderBy: { id: "asc" },
  });
}

/**
 * Soft-delete a pod by setting its deletedAt timestamp
 */
export async function softDeletePod(podId: string) {
  return db.pod.update({
    where: { id: podId },
    data: {
      deletedAt: new Date(),
    },
  });
}

/**
 * Find all soft-deleted pods for a swarm
 * Explicitly queries for deleted pods (deletedAt IS NOT NULL)
 */
export async function findDeletedPods(swarmId: string) {
  return db.pod.findMany({
    where: {
      swarmId,
      deletedAt: {
        not: null,
      },
    },
    orderBy: { deletedAt: "desc" },
  });
}
