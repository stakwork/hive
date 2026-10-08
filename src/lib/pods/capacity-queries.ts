import { db } from "@/lib/db";
import { VMData } from "@/types/pool-manager";
import { JOB_TURN_KIND, jobTitleOf } from "@/lib/strut-jobs";
import { POD_BASE_DOMAIN, jobOfClaimant } from "./queries";

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
      usageStatusMarkedAt: true,
      password: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Batch-fetch the claimants of all USED pods: a task by its id, a strut
  // job (`job:<id>`, strut plans/job-artifact-events.md §2) by the first
  // row of its turns — the title rides on every turn's input, the user is
  // who started it.
  const claimants = pods
    .filter((pod) => pod.usageStatus === "USED" && pod.usageStatusMarkedBy)
    .map((pod) => pod.usageStatusMarkedBy as string);
  const usedTaskIds = claimants.filter((c) => jobOfClaimant(c) === null);
  const usedJobIds = claimants.map(jobOfClaimant).filter((j): j is string => j !== null);

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

  const jobMap = new Map<string, { id: string; title: string; creator: { name: string | null; image: string | null } }>();

  if (usedJobIds.length > 0) {
    const turns = await db.strutRun.findMany({
      where: { jobId: { in: usedJobIds }, kind: JOB_TURN_KIND },
      orderBy: { createdAt: "asc" },
      select: { jobId: true, userId: true, input: true },
    });
    const firstTurn = new Map<string, { userId: string; input: unknown }>();
    for (const turn of turns) {
      if (turn.jobId && !firstTurn.has(turn.jobId)) firstTurn.set(turn.jobId, turn);
    }
    const users = firstTurn.size
      ? await db.user.findMany({
          where: { id: { in: Array.from(new Set(Array.from(firstTurn.values()).map((t) => t.userId))) } },
          select: { id: true, name: true, image: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    for (const [jobId, turn] of firstTurn) {
      const user = userMap.get(turn.userId);
      jobMap.set(jobId, { id: jobId, title: jobTitleOf(turn), creator: { name: user?.name ?? null, image: user?.image ?? null } });
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

    // Attach the claimant for used pods: the task, or the strut job
    const assignedTask =
      usage_status === "used" && pod.usageStatusMarkedBy
        ? (taskMap.get(pod.usageStatusMarkedBy) ?? null)
        : null;
    const jobId = usage_status === "used" ? jobOfClaimant(pod.usageStatusMarkedBy) : null;
    const assignedJob = jobId ? (jobMap.get(jobId) ?? { id: jobId, title: "Job", creator: { name: null, image: null } }) : null;

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
      assignedJob,
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
