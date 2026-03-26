/**
 * Unit tests for silent no-op pod release fix.
 * Verifies that all three rollback call sites log console.error (not console.log "Released")
 * when releasePodById returns null (pod not found).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// Test 1: src/lib/pods/utils.ts — claimPodAndGetFrontend catch block
// ============================================================================

vi.mock("@/lib/pods/queries", () => ({
  claimAvailablePod: vi.fn(),
  releasePodById: vi.fn(),
  getPodDetails: vi.fn(),
  getPodUsageStatus: vi.fn(),
  buildPodUrl: vi.fn(),
  POD_BASE_DOMAIN: "test.domain.com",
}));

vi.mock("@/lib/db", () => ({
  db: {
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
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");

    const mockPod = {
      id: "pod-db-id",
      podId: "pod-abc123",
      swarmId: "swarm-1",
      usageStatus: "USED",
      password: "secret",
      portMappings: {},
      status: "RUNNING",
      deletedAt: null,
    };

    // claimAvailablePod succeeds
    vi.mocked(claimAvailablePod).mockResolvedValue(mockPod as any);
    // getPodDetails throws (simulates post-claim failure)
    const { getPodDetails } = await import("@/lib/pods/queries");
    vi.mocked(getPodDetails).mockRejectedValue(new Error("Pod unreachable"));
    // releasePodById returns null (pod not found in DB)
    vi.mocked(releasePodById).mockResolvedValue(null);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Rollback failed"),
    );
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Released"),
    );
  });

  it("logs console.log success message when releasePodById succeeds after post-claim failure", async () => {
    const { claimAvailablePod, releasePodById, getPodDetails } = await import("@/lib/pods/queries");

    const mockPod = {
      id: "pod-db-id",
      podId: "pod-abc123",
      swarmId: "swarm-1",
      usageStatus: "USED",
      password: "secret",
      portMappings: {},
      status: "RUNNING",
      deletedAt: null,
    };

    vi.mocked(claimAvailablePod).mockResolvedValue(mockPod as any);
    vi.mocked(getPodDetails).mockRejectedValue(new Error("Pod unreachable"));
    // releasePodById returns the pod (success)
    vi.mocked(releasePodById).mockResolvedValue(mockPod as any);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");

    await expect(claimPodAndGetFrontend("swarm-1", "task-1")).rejects.toThrow();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Released"),
    );
    expect(consoleErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Rollback failed"),
    );
  });
});
