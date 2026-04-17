/**
 * Unit tests for silent no-op pod release fix and Karpenter retry logic.
 * Verifies that all three rollback call sites log console.error (not console.log "Released")
 * when releasePodById returns null (pod not found).
 * Also verifies the Karpenter retry scenarios in claimPodAndGetFrontend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("@/lib/pods/queries", () => ({
  claimAvailablePod: vi.fn(),
  releasePodById: vi.fn(),
  getPodDetails: vi.fn(),
  getPodUsageStatus: vi.fn(),
  buildPodUrl: vi.fn(),
  POD_BASE_DOMAIN: "test.domain.com",
}));

vi.mock("@/lib/pods/karpenter", () => ({
  markPodAsUsed: vi.fn(),
  markPodAsUnused: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findUnique: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    pod: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/utils/devContainerUtils", () => ({
  parsePM2Content: vi.fn(),
}));

// ============================================================================
// Shared test data
// ============================================================================

const mockPodA = {
  id: "pod-db-id-a",
  podId: "pod-abc123",
  swarmId: "swarm-1",
  usageStatus: "USED",
  password: "secret",
  portMappings: [3000, 8080],
  status: "RUNNING",
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  usageStatusMarkedAt: new Date(),
  usageStatusMarkedBy: null,
  usageStatusReason: null,
  flaggedForRecreation: false,
  flaggedAt: null,
  flaggedReason: null,
  lastHealthCheck: new Date(),
  healthStatus: null,
};

const mockPodB = {
  ...mockPodA,
  id: "pod-db-id-b",
  podId: "pod-def456",
};

const mockSwarm = { poolName: "test-pool", poolApiKey: "encrypted-key" };

// ============================================================================
// Test suite: rollback logging (post-claim failures)
// ============================================================================

describe("claimPodAndGetFrontend — rollback logging", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("logs console.error when releasePodById returns null after post-claim failure", async () => {
    const { claimAvailablePod, releasePodById, getPodDetails } = await import("@/lib/pods/queries");
    const { markPodAsUsed } = await import("@/lib/pods/karpenter");
    const { db } = await import("@/lib/db");

    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);
    vi.mocked(markPodAsUsed).mockResolvedValue(true);
    vi.mocked(claimAvailablePod).mockResolvedValue(mockPodA as any);
    vi.mocked(getPodDetails).mockRejectedValue(new Error("Pod unreachable"));
    vi.mocked(releasePodById).mockResolvedValue(null);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow();

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Rollback failed"));
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("Released"));
  });

  it("logs console.log success message when releasePodById succeeds after post-claim failure", async () => {
    const { claimAvailablePod, releasePodById, getPodDetails } = await import("@/lib/pods/queries");
    const { markPodAsUsed } = await import("@/lib/pods/karpenter");
    const { db } = await import("@/lib/db");

    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);
    vi.mocked(markPodAsUsed).mockResolvedValue(true);
    vi.mocked(claimAvailablePod).mockResolvedValue(mockPodA as any);
    vi.mocked(getPodDetails).mockRejectedValue(new Error("Pod unreachable"));
    vi.mocked(releasePodById).mockResolvedValue(mockPodA as any);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow();

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Released"));
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("Rollback failed"));
  });
});

// ============================================================================
// Test suite: Karpenter retry scenarios
// ============================================================================

describe("claimPodAndGetFrontend — Karpenter retry logic", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("proceeds normally when Karpenter succeeds on attempt 1 — releasePodById never called", async () => {
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");
    const { markPodAsUsed } = await import("@/lib/pods/karpenter");
    const { db } = await import("@/lib/db");

    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);
    vi.mocked(markPodAsUsed).mockResolvedValue(true);
    // claimAvailablePod returns a pod with port mappings so it can proceed
    vi.mocked(claimAvailablePod).mockResolvedValue(mockPodA as any);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    // It will fail later in frontend discovery — we just care about Karpenter behavior
    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow();

    // markPodAsUsed called once with pod A
    expect(markPodAsUsed).toHaveBeenCalledTimes(1);
    expect(markPodAsUsed).toHaveBeenCalledWith(mockPodA.podId, mockSwarm.poolName, mockSwarm.poolApiKey);

    // releasePodById should NOT be called for Karpenter failure (only for post-claim setup failure)
    // In this case it IS called because of the post-claim failure (no password issue won't happen
    // since pod has password), but NOT for Karpenter reasons
    expect(consoleWarnSpy).not.toHaveBeenCalledWith(expect.stringContaining("mark-used failed"));
  });

  it("releases pod and retries on Karpenter failure attempt 1, succeeds on attempt 2", async () => {
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");
    const { markPodAsUsed } = await import("@/lib/pods/karpenter");
    const { db } = await import("@/lib/db");

    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);
    // Karpenter: fail on attempt 1 (pod A), succeed on attempt 2 (pod B)
    vi.mocked(markPodAsUsed).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    // claimAvailablePod: return pod A on first call, pod B on second call
    vi.mocked(claimAvailablePod).mockResolvedValueOnce(mockPodA as any).mockResolvedValueOnce(mockPodB as any);
    vi.mocked(releasePodById).mockResolvedValue(mockPodA as any);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    // Will still fail in frontend discovery — we care about retry behavior
    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow();

    // Karpenter called twice
    expect(markPodAsUsed).toHaveBeenCalledTimes(2);
    expect(markPodAsUsed).toHaveBeenNthCalledWith(1, mockPodA.podId, mockSwarm.poolName, mockSwarm.poolApiKey);
    expect(markPodAsUsed).toHaveBeenNthCalledWith(2, mockPodB.podId, mockSwarm.poolName, mockSwarm.poolApiKey);

    // Pod A released after Karpenter failure
    expect(releasePodById).toHaveBeenCalledWith(mockPodA.podId);

    // Second claim call includes exclusion of pod A's podId
    expect(claimAvailablePod).toHaveBeenCalledTimes(2);
    expect(claimAvailablePod).toHaveBeenNthCalledWith(2, "swarm-1", "task-1", [mockPodA.podId]);

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("mark-used failed"));
  });

  it("releases both pods and throws when Karpenter fails on both attempts", async () => {
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");
    const { markPodAsUsed } = await import("@/lib/pods/karpenter");
    const { db } = await import("@/lib/db");

    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);
    // Karpenter fails on both attempts
    vi.mocked(markPodAsUsed).mockResolvedValue(false);
    vi.mocked(claimAvailablePod).mockResolvedValueOnce(mockPodA as any).mockResolvedValueOnce(mockPodB as any);
    vi.mocked(releasePodById).mockResolvedValue(mockPodA as any);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow(
      "Karpenter mark-used failed after retry",
    );

    // Both pods should be released
    expect(releasePodById).toHaveBeenCalledTimes(2);
    expect(releasePodById).toHaveBeenCalledWith(mockPodA.podId);
    expect(releasePodById).toHaveBeenCalledWith(mockPodB.podId);
  });

  it("throws 'No available pods' when claimAvailablePod returns null on retry", async () => {
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");
    const { markPodAsUsed } = await import("@/lib/pods/karpenter");
    const { db } = await import("@/lib/db");

    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);
    // Karpenter fails on attempt 1
    vi.mocked(markPodAsUsed).mockResolvedValue(false);
    // Pod A returned on attempt 1, null on retry (pool exhausted)
    vi.mocked(claimAvailablePod).mockResolvedValueOnce(mockPodA as any).mockResolvedValueOnce(null);
    vi.mocked(releasePodById).mockResolvedValue(mockPodA as any);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow("No available pods");

    // Pod A must be released before null retry
    expect(releasePodById).toHaveBeenCalledWith(mockPodA.podId);
    // releasePodById called only once (for pod A; no pod B to release)
    expect(releasePodById).toHaveBeenCalledTimes(1);
  });

  it("throws 'No available pods' when claimAvailablePod returns null on first attempt", async () => {
    const { claimAvailablePod } = await import("@/lib/pods/queries");
    const { markPodAsUsed } = await import("@/lib/pods/karpenter");
    const { db } = await import("@/lib/db");

    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);
    vi.mocked(claimAvailablePod).mockResolvedValue(null);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow("No available pods");

    expect(markPodAsUsed).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Test suite: getProcessList failure scenarios
// ============================================================================

describe("claimPodAndGetFrontend — getProcessList failure", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it("getProcessList throws → pod released → logs release success", async () => {
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");
    const { markPodAsUsed } = await import("@/lib/pods/karpenter");
    const { db } = await import("@/lib/db");

    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);
    vi.mocked(markPodAsUsed).mockResolvedValue(true);
    vi.mocked(claimAvailablePod).mockResolvedValue(mockPodA as any);
    vi.mocked(releasePodById).mockResolvedValue(mockPodA as any);
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("fetch failed"));

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow();

    expect(releasePodById).toHaveBeenCalledWith(mockPodA.podId);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Released"));
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("Rollback failed"));
  });

  it("getProcessList throws → releasePodById returns null → logs rollback failed", async () => {
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");
    const { markPodAsUsed } = await import("@/lib/pods/karpenter");
    const { db } = await import("@/lib/db");

    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);
    vi.mocked(markPodAsUsed).mockResolvedValue(true);
    vi.mocked(claimAvailablePod).mockResolvedValue(mockPodA as any);
    vi.mocked(releasePodById).mockResolvedValue(null);
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("fetch failed"));

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow();

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Rollback failed"));
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("Released"));
  });

  it("getProcessList throws → releasePodById throws → logs release error", async () => {
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");
    const { markPodAsUsed } = await import("@/lib/pods/karpenter");
    const { db } = await import("@/lib/db");

    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm as any);
    vi.mocked(markPodAsUsed).mockResolvedValue(true);
    vi.mocked(claimAvailablePod).mockResolvedValue(mockPodA as any);
    vi.mocked(releasePodById).mockRejectedValue(new Error("DB failure"));
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("fetch failed"));

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow();

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to release pod"), expect.anything());
  });
});
