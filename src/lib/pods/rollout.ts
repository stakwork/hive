import { PodStatus, PodUsageStatus } from "@prisma/client";

export const PUSH_TIMEOUT_MS = 5 * 60 * 1000;

export type RolloutState = "idle" | "pushing" | "rolling" | "ready" | "failed";

export interface RolloutSwarmInput {
  poolChangeId: string | null;
  poolChangeRequestedAt: Date | null;
  poolPushedAt: Date | null;
  poolPushError: string | null;
  minimumVms: number | null;
}

export interface RolloutPodInput {
  status: PodStatus;
  usageStatus: PodUsageStatus;
  createdAt: Date;
  flaggedForRecreation: boolean;
}

export interface PoolRollout {
  state: RolloutState;
  changeId: string | null;
  requestedAt: Date | null;
  pushedAt: Date | null;
  error: string | null;
  pods: {
    new: number;
    old: number;
    oldInUse: number;
    pending: number;
    failed: number;
    minimumVms: number | null;
  };
}

const PENDING: PodStatus[] = [PodStatus.PENDING, PodStatus.STARTING, PodStatus.CREATING];
const FAILED: PodStatus[] = [PodStatus.FAILED, PodStatus.STOPPED, PodStatus.CRASHING, PodStatus.UNSTABLE];

export function getPoolRolloutStatus(swarm: RolloutSwarmInput, pods: RolloutPodInput[], now: Date): PoolRollout {
  const { poolChangeId, poolChangeRequestedAt, poolPushedAt, poolPushError } = swarm;

  const isNew = (p: RolloutPodInput) => poolPushedAt !== null && p.createdAt > poolPushedAt;

  const counts = { new: 0, old: 0, oldInUse: 0, pending: 0, failed: 0, minimumVms: swarm.minimumVms };
  let readyPod = false;
  for (const p of pods) {
    if (isNew(p)) {
      counts.new++;
      if (p.status === PodStatus.RUNNING && p.usageStatus === PodUsageStatus.UNUSED && !p.flaggedForRecreation) {
        readyPod = true;
      }
    } else {
      counts.old++;
      if (p.usageStatus === PodUsageStatus.USED) counts.oldInUse++;
    }
    if (PENDING.includes(p.status)) counts.pending++;
    else if (FAILED.includes(p.status)) counts.failed++;
  }

  let state: RolloutState;
  let error: string | null = poolPushError;
  if (!poolChangeId) {
    state = "idle";
  } else if (poolPushError) {
    state = "failed";
  } else if (!poolPushedAt) {
    const age = poolChangeRequestedAt ? now.getTime() - poolChangeRequestedAt.getTime() : 0;
    if (age > PUSH_TIMEOUT_MS) {
      state = "failed";
      error = "push_timeout";
    } else {
      state = "pushing";
    }
  } else {
    state = readyPod ? "ready" : "rolling";
  }

  return {
    state,
    changeId: poolChangeId,
    requestedAt: poolChangeRequestedAt,
    pushedAt: poolPushedAt,
    error,
    pods: counts,
  };
}

export async function loadPoolRollout(
  db: typeof import("@/lib/db").db,
  swarm: RolloutSwarmInput & { id: string },
  now: Date = new Date(),
): Promise<PoolRollout> {
  const pods = await db.pod.findMany({
    where: {
      swarmId: swarm.id,
      deletedAt: null,
      podId: { not: { startsWith: "ws-pool-" } },
      status: { notIn: [PodStatus.TERMINATING, PodStatus.MOTHBALLED] },
    },
    select: { status: true, usageStatus: true, createdAt: true, flaggedForRecreation: true },
  });
  return getPoolRolloutStatus(swarm, pods, now);
}
