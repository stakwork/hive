import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const m = vi.hoisted(() => ({ revoke: vi.fn(async () => {}) }));
const claimedAt = new Date("2026-01-01T00:00:00Z");

vi.mock("@/services/bifrost/pod-budget", () => ({ revokePodClaimPermission: m.revoke }));
vi.mock("@/lib/pods/karpenter", () => ({ markPodAsUnused: vi.fn(async () => {}) }));
vi.mock("@/lib/db", () => {
  const tx = {
    pod: {
      findFirst: vi.fn(async () => ({ id: "row-1", usageStatusMarkedAt: claimedAt })),
      update: vi.fn(async () => ({ id: "row-1", podId: "pod-9", swarmId: "swarm-1" })),
    },
    task: { updateMany: vi.fn(async () => ({})) },
  };
  return {
    db: {
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
      swarm: { findUnique: vi.fn(async () => null) },
    },
  };
});

import { releasePodById } from "@/lib/pods/queries";

describe("releasePodById pod budget revoke", () => {
  const original = process.env.POD_MOTHERSHIP_BUDGET_ENABLED;
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    if (original !== undefined) process.env.POD_MOTHERSHIP_BUDGET_ENABLED = original;
    else delete process.env.POD_MOTHERSHIP_BUDGET_ENABLED;
  });

  it("flag off: no revoke attempted", async () => {
    delete process.env.POD_MOTHERSHIP_BUDGET_ENABLED;
    await releasePodById("pod-9");
    await new Promise((r) => setTimeout(r, 10));
    expect(m.revoke).not.toHaveBeenCalled();
  });

  it("flag on: revokes with the claim time read before release", async () => {
    process.env.POD_MOTHERSHIP_BUDGET_ENABLED = "true";
    await releasePodById("pod-9");
    await vi.waitFor(() => expect(m.revoke).toHaveBeenCalledWith("swarm-1", "pod-9", claimedAt));
  });
});
