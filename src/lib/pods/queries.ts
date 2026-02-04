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

/**
 * Atomically claim an available pod for a user
 * Uses SELECT FOR UPDATE SKIP LOCKED to prevent race conditions
 *
 * @param swarmId - The swarm ID to claim a pod from
 * @param userId - The user ID claiming the pod
 * @returns The claimed pod or null if none available
 */
export async function claimAvailablePod(
  swarmId: string,
  userId: string
): Promise<Pod | null> {
  // Use raw SQL for atomic SELECT FOR UPDATE SKIP LOCKED
  interface RawPodResult {
    id: string;
    pod_id: string;
    swarm_id: string;
    status: PodStatus;
    usage_status: PodUsageStatus;
    usage_status_marked_at: Date | null;
    usage_status_marked_by: string | null;
    usage_status_reason: string | null;
    password: string | null;
    port_mappings: any;
    flagged_for_recreation: boolean;
    flagged_at: Date | null;
    flagged_reason: string | null;
    last_health_check: Date | null;
    health_status: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
  }

  const rawPods = await db.$queryRaw<RawPodResult[]>`
    UPDATE pods
    SET 
      usage_status = 'USED'::"PodUsageStatus",
      usage_status_marked_at = NOW(),
      usage_status_marked_by = ${userId}
    WHERE id = (
      SELECT id FROM pods
      WHERE 
        swarm_id = ${swarmId}
        AND status = 'RUNNING'::"PodStatus"
        AND usage_status = 'UNUSED'::"PodUsageStatus"
        AND deleted_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;

  if (rawPods.length === 0) {
    return null;
  }

  // Map snake_case to camelCase
  const rawPod = rawPods[0];
  return {
    id: rawPod.id,
    podId: rawPod.pod_id,
    swarmId: rawPod.swarm_id,
    status: rawPod.status,
    usageStatus: rawPod.usage_status,
    usageStatusMarkedAt: rawPod.usage_status_marked_at,
    usageStatusMarkedBy: rawPod.usage_status_marked_by,
    usageStatusReason: rawPod.usage_status_reason,
    password: rawPod.password,
    portMappings: rawPod.port_mappings,
    flaggedForRecreation: rawPod.flagged_for_recreation,
    flaggedAt: rawPod.flagged_at,
    flaggedReason: rawPod.flagged_reason,
    lastHealthCheck: rawPod.last_health_check,
    healthStatus: rawPod.health_status,
    createdAt: rawPod.created_at,
    updatedAt: rawPod.updated_at,
    deletedAt: rawPod.deleted_at,
  } as Pod;
}

/**
 * Get pod details (password and port mappings)
 * Used for retrieving credentials after claiming
 *
 * @param podId - The pod ID (workspace identifier, not primary key)
 * @returns Pod details or null if not found
 */
export async function getPodDetails(
  podId: string
): Promise<{ password: string | null; portMappings: Record<string, string> | null } | null> {
  const pod = await db.pod.findFirst({
    where: {
      podId,
      deletedAt: null,
    },
    select: {
      password: true,
      portMappings: true,
    },
  });

  if (!pod) {
    return null;
  }

  return {
    password: pod.password,
    portMappings: pod.portMappings as Record<string, string> | null,
  };
}

/**
 * Release a pod by ID and clear task associations
 * Uses transaction to ensure atomicity
 *
 * @param podId - The pod ID (workspace identifier) to release
 * @returns The released pod or null if not found
 */
export async function releasePodById(podId: string): Promise<Pod | null> {
  return db.$transaction(async (tx) => {
    // First, find the pod to ensure it exists
    const existingPod = await tx.pod.findFirst({
      where: {
        podId,
        deletedAt: null,
      },
    });

    if (!existingPod) {
      return null;
    }

    // Clear task associations
    await tx.task.updateMany({
      where: {
        podId,
      },
      data: {
        podId: null,
      },
    });

    // Release the pod
    const updatedPod = await tx.pod.update({
      where: {
        id: existingPod.id,
      },
      data: {
        usageStatus: PodUsageStatus.UNUSED,
        usageStatusMarkedAt: null,
        usageStatusMarkedBy: null,
        usageStatusReason: null,
      },
    });

    return updatedPod;
  });
}

/**
 * Get pod usage status information
 *
 * @param podId - The pod ID (workspace identifier) to query
 * @returns Usage status details or null if not found
 */
export async function getPodUsageStatus(
  podId: string
): Promise<{
  usageStatus: PodUsageStatus;
  usageStatusMarkedAt: Date | null;
  usageStatusMarkedBy: string | null;
} | null> {
  const pod = await db.pod.findFirst({
    where: {
      podId,
      deletedAt: null,
    },
    select: {
      usageStatus: true,
      usageStatusMarkedAt: true,
      usageStatusMarkedBy: true,
    },
  });

  return pod;
}
