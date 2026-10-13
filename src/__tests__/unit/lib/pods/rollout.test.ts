import { describe, it, expect } from "vitest";
import { PodStatus, PodUsageStatus } from "@prisma/client";
import { getPoolRolloutStatus, type RolloutPodInput } from "@/lib/pods/rollout";

const now = new Date("2026-01-01T12:00:00Z");
const min = (n: number) => new Date(now.getTime() - n * 60_000);

const base = {
  poolChangeId: "c1",
  poolChangeRequestedAt: min(1),
  poolPushedAt: null as Date | null,
  poolPushError: null as string | null,
  minimumVms: 2,
};
const pod = (o: Partial<RolloutPodInput> = {}): RolloutPodInput => ({
  status: PodStatus.RUNNING,
  usageStatus: PodUsageStatus.UNUSED,
  createdAt: min(30),
  flaggedForRecreation: false,
  ...o,
});

describe("getPoolRolloutStatus", () => {
  it("idle without a changeId", () => {
    const r = getPoolRolloutStatus({ ...base, poolChangeId: null, poolChangeRequestedAt: null }, [pod()], now);
    expect(r.state).toBe("idle");
    expect(r.pods.old).toBe(1);
    expect(r.pods.new).toBe(0);
  });

  it("pushing while recent with no result", () => {
    expect(getPoolRolloutStatus(base, [], now).state).toBe("pushing");
  });

  it("failed with push_timeout when pushing > 5 minutes", () => {
    const r = getPoolRolloutStatus({ ...base, poolChangeRequestedAt: min(6) }, [], now);
    expect(r.state).toBe("failed");
    expect(r.error).toBe("push_timeout");
  });

  it("failed when a push error is recorded", () => {
    const r = getPoolRolloutStatus({ ...base, poolPushError: "boom" }, [], now);
    expect(r).toMatchObject({ state: "failed", error: "boom", changeId: "c1" });
  });

  it("rolling when pushed but no new ready pod; counts old/new/pending/failed", () => {
    const pods = [
      pod({ usageStatus: PodUsageStatus.USED }), // old in use
      pod(), // old
      pod({ createdAt: min(1), status: PodStatus.STARTING }), // new pending
      pod({ createdAt: min(1), status: PodStatus.CRASHING }), // new failed
      pod({ createdAt: min(1), flaggedForRecreation: true }), // new, flagged -> not ready
    ];
    const r = getPoolRolloutStatus({ ...base, poolPushedAt: min(2) }, pods, now);
    expect(r.state).toBe("rolling");
    expect(r.pods).toEqual({ new: 3, old: 2, oldInUse: 1, pending: 1, failed: 1, minimumVms: 2 });
  });

  it("ready when a new RUNNING UNUSED unflagged pod exists", () => {
    const r = getPoolRolloutStatus({ ...base, poolPushedAt: min(2) }, [pod(), pod({ createdAt: min(1) })], now);
    expect(r.state).toBe("ready");
    expect(r.pods.new).toBe(1);
  });

  it("a used new pod is not ready", () => {
    const r = getPoolRolloutStatus(
      { ...base, poolPushedAt: min(2) },
      [pod({ createdAt: min(1), usageStatus: PodUsageStatus.USED })],
      now,
    );
    expect(r.state).toBe("rolling");
  });
});
