import { db } from "@/lib/db";
import { VMData } from "@/types/pool-manager";
import { buildPodUrl } from "./queries";
import { POD_PORTS } from "./constants";

/**
 * Fast database-only query for basic VM data
 * Returns VM data without real-time resource metrics for immediate rendering
 */
export async function getBasicVMDataFromPods(
  swarmId: string
): Promise<VMData[]> {
  const pods = await db.pod.findMany({
    where: {
      swarmId,
      deletedAt: null, // Filter out soft-deleted pods
    },
    select: {
      podId: true,
      status: true,
      usageStatus: true,
      usageStatusMarkedAt: true,
      usageStatusMarkedBy: true,
      password: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const taskIdsByPodId = new Map(
    (
      await db.task.findMany({
        where: {
          deleted: false,
          archived: false,
          podId: {
            in: pods.map((pod) => pod.podId),
          },
        },
        select: {
          id: true,
          podId: true,
        },
      })
    ).map((task) => [task.podId!, task.id]),
  );

  return pods.map((pod) => {
    const url = buildPodUrl(pod.podId, POD_PORTS.CONTROL);
    const subdomain = pod.podId;

    // Map database status to pool-manager state format
    let state: string;
    switch (pod.status) {
      case "PENDING":
        state = "pending";
        break;
      case "RUNNING":
        state = "running";
        break;
      case "FAILED":
        state = "failed";
        break;
      default:
        state = "unknown";
    }

    // Map database usageStatus to pool-manager format
    const usage_status = pod.usageStatus === "USED" ? "used" : "unused";

    // Task.podId is the authoritative task-to-pod link during Phase 1.
    // Fall back to usageStatusMarkedBy for non-task/manual claims.
    const user_info =
      usage_status === "used"
        ? taskIdsByPodId.get(pod.podId) ?? pod.usageStatusMarkedBy ?? undefined
        : undefined;

    return {
      id: pod.podId,
      subdomain,
      state,
      internal_state: state, // Use same value as state for basic query
      usage_status,
      user_info: user_info ?? null,
      marked_at: pod.usageStatusMarkedAt?.toISOString() ?? null,
      password: pod.password || undefined,
      url,
      repository: undefined, // Not available in basic query
      resource_usage: {
        available: false, // Mark as unavailable - will be fetched from pool-manager
        requests: {
          cpu: "0",
          memory: "0",
        },
        usage: {
          cpu: "0",
          memory: "0",
        },
      },
    };
  });
}
