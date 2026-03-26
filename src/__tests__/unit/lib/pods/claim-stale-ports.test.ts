/**
 * Unit tests for stale port-mapping fix in claimPodAndGetFrontend.
 *
 * Verifies that:
 * 1. Pods with empty portMappings claim successfully (jlist rebuilds mappings)
 * 2. Pods with stale portMappings (missing 15552) still succeed
 * 3. If jlist throws, the claim still succeeds with the control port in portMappings as fallback
 * 4. Happy-path (portMappings already correct) continues to work unchanged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---- mocks ----------------------------------------------------------------

vi.mock("@/lib/pods/queries", () => ({
  claimAvailablePod: vi.fn(),
  releasePodById: vi.fn(),
  getPodDetails: vi.fn(),
  getPodUsageStatus: vi.fn(),
  buildPodUrl: vi.fn((podId: string, port: number | string) => `https://${podId}-${port}.workspaces.sphinx.chat`),
  POD_BASE_DOMAIN: "workspaces.sphinx.chat",
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: { findUnique: vi.fn(), update: vi.fn() },
    pod: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
}));

vi.mock("@/utils/devContainerUtils", () => ({
  parsePM2Content: vi.fn(),
}));

// ---- helpers ---------------------------------------------------------------

/** Mock jlist response: two processes returned by the pod control endpoint */
const MOCK_PROCESS_LIST = [
  { pid: 1, name: "goose", status: "online", port: "15551", pm_uptime: 100 },
  { pid: 2, name: "frontend", status: "online", port: "3000", pm_uptime: 100 },
];

/**
 * Build a minimal Pod DB record as returned by claimAvailablePod.
 * portMappings is typed as number[] in the DB model.
 */
function createTestPod(portMappings: number[]) {
  return {
    id: "pod-db-id",
    podId: "pod-abc123",
    swarmId: "swarm-1",
    usageStatus: "USED",
    password: "secret",
    portMappings,
    status: "RUNNING",
    deletedAt: null,
    flaggedForRecreation: false,
    createdAt: new Date("2024-01-01"),
    usageStatusMarkedAt: new Date("2024-01-01"),
  };
}

// ---- tests -----------------------------------------------------------------

describe("claimPodAndGetFrontend — stale/empty portMappings", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Default: fetch succeeds and returns the mock process list
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => MOCK_PROCESS_LIST,
    } as Response);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it("Empty portMappings — claim succeeds and portMappings are rebuilt from jlist", async () => {
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");

    vi.mocked(claimAvailablePod).mockResolvedValue(createTestPod([]) as any);
    vi.mocked(releasePodById).mockResolvedValue(null);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");
    const result = await claimPodAndGetFrontend("swarm-1", "task-1");

    // Should have rebuilt portMappings from jlist + control port
    expect(result.workspace.portMappings["15552"]).toBe(
      "https://pod-abc123-15552.workspaces.sphinx.chat",
    );
    expect(result.workspace.portMappings["15551"]).toBe(
      "https://pod-abc123-15551.workspaces.sphinx.chat",
    );
    expect(result.workspace.portMappings["3000"]).toBe(
      "https://pod-abc123-3000.workspaces.sphinx.chat",
    );
  });

  it("Stale portMappings (only [8444], missing 15552) — claim succeeds, jlist data replaces stale data", async () => {
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");

    vi.mocked(claimAvailablePod).mockResolvedValue(createTestPod([8444]) as any);
    vi.mocked(releasePodById).mockResolvedValue(null);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");
    const result = await claimPodAndGetFrontend("swarm-1", "task-1");

    // Control + jlist ports must be present
    expect(result.workspace.portMappings["15552"]).toBe(
      "https://pod-abc123-15552.workspaces.sphinx.chat",
    );
    expect(result.workspace.portMappings["15551"]).toBe(
      "https://pod-abc123-15551.workspaces.sphinx.chat",
    );
    expect(result.workspace.portMappings["3000"]).toBe(
      "https://pod-abc123-3000.workspaces.sphinx.chat",
    );
  });

  it("jlist throws — claim still succeeds and portMappings contains at least the control port", async () => {
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");

    vi.mocked(claimAvailablePod).mockResolvedValue(createTestPod([]) as any);
    vi.mocked(releasePodById).mockResolvedValue(null);

    // Simulate jlist network failure
    fetchSpy.mockRejectedValue(new Error("Connection refused"));

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");
    // Even with jlist failing, the claim should not throw — fallback URL construction applies
    const result = await claimPodAndGetFrontend("swarm-1", "task-1");

    // Control port must always be set from buildPodUrl fallback
    expect(result.workspace.portMappings["15552"]).toBe(
      "https://pod-abc123-15552.workspaces.sphinx.chat",
    );

    // Error should be logged
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to fetch process list"),
      expect.any(Error),
    );
  });

  it("Happy path — pod with correct portMappings and successful jlist preserves existing behaviour", async () => {
    const { claimAvailablePod, releasePodById } = await import("@/lib/pods/queries");

    vi.mocked(claimAvailablePod).mockResolvedValue(createTestPod([3000, 15551, 15552]) as any);
    vi.mocked(releasePodById).mockResolvedValue(null);

    const { claimPodAndGetFrontend } = await import("@/lib/pods/utils");
    const result = await claimPodAndGetFrontend("swarm-1", "task-1");

    // All three ports should be present after jlist rebuild
    expect(result.workspace.portMappings["15552"]).toBe(
      "https://pod-abc123-15552.workspaces.sphinx.chat",
    );
    expect(result.workspace.portMappings["15551"]).toBe(
      "https://pod-abc123-15551.workspaces.sphinx.chat",
    );
    expect(result.workspace.portMappings["3000"]).toBe(
      "https://pod-abc123-3000.workspaces.sphinx.chat",
    );

    // Frontend should be resolved
    expect(result.frontend).toBeDefined();
  });
});
