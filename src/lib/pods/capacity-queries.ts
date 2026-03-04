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
      usageStatusMarkedBy: true,
      usageStatusMarkedAt: true,
      password: true,
      createdAt: true,
      flaggedForRecreation: true,
      flaggedReason: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Batch-fetch tasks linked to these pods
  const podIds = pods.map((p) => p.podId);
  const tasks = await db.task.findMany({
    where: { podId: { in: podIds } },
    select: {
      id: true,
      title: true,
      podId: true,
      assignee: { select: { id: true, name: true } },
    },
  });
  const taskByPodId = Object.fromEntries(
    tasks.map((t) => [t.podId, t])
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

    // Use usageStatusMarkedBy as user_info if VM is in use
    const user_info =
      usage_status === "used" ? pod.usageStatusMarkedBy ?? undefined : undefined;

    const task = taskByPodId[pod.podId];

    return {
      id: pod.podId,
      subdomain,
      state,
      internal_state: state, // Use same value as state for basic query
      usage_status,
      user_info: user_info ?? null,
      // Fix: use usageStatusMarkedAt (not createdAt) for accurate elapsed time
      marked_at: pod.usageStatusMarkedAt?.toISOString() ?? null,
      password: pod.password || undefined,
      url,
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
      // Flagging fields
      flaggedForRecreation: pod.flaggedForRecreation,
      flaggedReason: pod.flaggedReason ?? null,
      // Task context
      taskId: task?.id ?? null,
      taskTitle: task?.title ?? null,
      assigneeName: task?.assignee?.name ?? null,
    };
  });
}
