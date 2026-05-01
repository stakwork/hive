import { db } from "@/lib/db";
import { VMData } from "@/types/pool-manager";
import { POD_BASE_DOMAIN } from "./queries";

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
      podId: { not: { startsWith: "ws-pool-" } }, // exclude infrastructure pods
    },
    select: {
      podId: true,
      status: true,
      usageStatus: true,
      usageStatusMarkedBy: true,
      password: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Batch-fetch tasks for all USED pods in a single query
  const usedTaskIds = pods
    .filter((pod) => pod.usageStatus === "USED" && pod.usageStatusMarkedBy)
    .map((pod) => pod.usageStatusMarkedBy as string);

  const taskMap = new Map<string, { id: string; title: string; createdBy: { name: string | null; image: string | null } }>();

  if (usedTaskIds.length > 0) {
    const tasks = await db.task.findMany({
      where: { id: { in: usedTaskIds } },
      select: {
        id: true,
        title: true,
        createdBy: { select: { name: true, image: true } },
      },
    });
    for (const task of tasks) {
      taskMap.set(task.id, task);
    }
  }

  return pods.map((pod) => {
    // IDE URL is the bare pod hostname (proxied to code-server). No port suffix.
    // The "Open Browser" frontend URL is resolved on-demand via /jlist (see
    // /api/w/[slug]/pool/[podId]/frontend-url) since the frontend port is
    // pod-specific and may not be 3000.
    const url = `https://${pod.podId}.${POD_BASE_DOMAIN}`;
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

    // Use usageStatusMarkedBy as user_info if VM is in use
    const user_info =
      usage_status === "used" ? pod.usageStatusMarkedBy ?? undefined : undefined;

    // Attach task info for used pods
    const assignedTask =
      usage_status === "used" && pod.usageStatusMarkedBy
        ? (taskMap.get(pod.usageStatusMarkedBy) ?? null)
        : null;

    return {
      id: pod.podId,
      subdomain,
      state,
      internal_state: state, // Use same value as state for basic query
      usage_status,
      user_info: user_info ?? null,
      marked_at: pod.usageStatusMarkedBy ? pod.createdAt.toISOString() : null,
      password: pod.password || undefined,
      url,
      repository: undefined, // Not available in basic query
      assignedTask: assignedTask
        ? {
            id: assignedTask.id,
            title: assignedTask.title,
            creator: {
              name: assignedTask.createdBy.name,
              image: assignedTask.createdBy.image,
            },
          }
        : null,
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
