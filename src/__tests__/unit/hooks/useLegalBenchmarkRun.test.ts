import { renderHook, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useLegalBenchmarkRun } from "@/hooks/useLegalBenchmarkRun";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockChannel = {
  bind: vi.fn(),
  unbind: vi.fn(),
};

const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
};

const mockWorkspace = {
  id: "workspace-123",
  slug: "openlaw",
};

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(() => ({ workspace: mockWorkspace })),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => mockPusherClient),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
  },
}));

global.fetch = vi.fn();

const MOCK_RUNNER_ROW = {
  id: "runner-abc",
  workspaceId: "workspace-123",
  type: "LEGAL_BENCHMARK_RUNNER",
  status: "IN_PROGRESS",
  projectId: null,
  result: JSON.stringify({
    taskSlug: "antitrust/task-1",
    taskTitle: "Analyze Antitrust Strategy",
    siblingRunId: "scorer-abc",
  }),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const MOCK_SCORER_ROW = {
  id: "scorer-abc",
  workspaceId: "workspace-123",
  type: "LEGAL_BENCHMARK_SCORER",
  status: "PENDING",
  projectId: null,
  result: JSON.stringify({
    taskSlug: "antitrust/task-1",
    taskTitle: "Analyze Antitrust Strategy",
    siblingRunId: "runner-abc",
  }),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** Helper: set up fetch to return the standard runner+scorer pair. */
function setupFetchWithPair(
  runnerOverrides: Partial<typeof MOCK_RUNNER_ROW> = {},
  scorerOverrides: Partial<typeof MOCK_SCORER_ROW> = {},
) {
  vi.mocked(global.fetch).mockImplementation((url: RequestInfo | URL) => {
    const urlStr = String(url);
    if (urlStr.includes("LEGAL_BENCHMARK_RUNNER")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ runs: [{ ...MOCK_RUNNER_ROW, ...runnerOverrides }] }),
      } as Response);
    }
    if (urlStr.includes("LEGAL_BENCHMARK_SCORER")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ runs: [{ ...MOCK_SCORER_ROW, ...scorerOverrides }] }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ runs: [] }),
    } as Response);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useLegalBenchmarkRun", () => {
  const runId = "runner-abc";

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setupFetchWithPair();
  });

  it("fires initial fetch against /api/stakwork/runs for both RUNNER and SCORER types", async () => {
    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Expect exactly two calls: one per type
    expect(global.fetch).toHaveBeenCalledTimes(2);
    const urls = vi.mocked(global.fetch).mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes("LEGAL_BENCHMARK_RUNNER"))).toBe(true);
    expect(urls.some((u) => u.includes("LEGAL_BENCHMARK_SCORER"))).toBe(true);
    // Both must include the workspaceId
    urls.forEach((u) => expect(u).toContain("workspace-123"));
  });

  it("sets isLoading to true initially, false after fetch", async () => {
    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("derives composite running status when runner is IN_PROGRESS", async () => {
    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run!.status).toBe("running");
    expect(result.current.run!.id).toBe("runner-abc");
    expect(result.current.run!.taskSlug).toBe("antitrust/task-1");
  });

  it("derives composite scoring status when runner is COMPLETED and scorer is IN_PROGRESS", async () => {
    setupFetchWithPair(
      { status: "COMPLETED" },
      { status: "IN_PROGRESS" },
    );

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run!.status).toBe("scoring");
  });

  it("derives composite complete status when scorer is COMPLETED", async () => {
    setupFetchWithPair(
      { status: "COMPLETED" },
      {
        status: "COMPLETED",
        result: JSON.stringify({
          taskSlug: "antitrust/task-1",
          taskTitle: "Analyze Antitrust Strategy",
          siblingRunId: "runner-abc",
          scoreJson: JSON.stringify([{ criterion: "Accuracy", pass: true, notes: "OK" }]),
        }),
      },
    );

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run!.status).toBe("complete");
    expect(result.current.run!.scoreJson).toBeTruthy();
  });

  it("derives composite failed status when runner is FAILED", async () => {
    setupFetchWithPair({ status: "FAILED" });

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run!.status).toBe("failed");
  });

  it("derives composite failed status when scorer is FAILED", async () => {
    setupFetchWithPair({ status: "COMPLETED" }, { status: "FAILED" });

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run!.status).toBe("failed");
  });

  it("can resolve the pair from the scorer id (fallback path)", async () => {
    // When runId is the scorer's id, hook should still find the runner via siblingRunId.
    const { result } = renderHook(() => useLegalBenchmarkRun("scorer-abc"));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    // Resolved runner id is the primary id of the returned run.
    expect(result.current.run!.id).toBe("runner-abc");
  });

  it("subscribes to Pusher channel using STAKWORK_RUN_UPDATE event", async () => {
    renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("workspace-openlaw");
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "stakwork-run-update",
        expect.any(Function),
      );
    });
  });

  it("refetches when STAKWORK_RUN_UPDATE event has matching runner runId", async () => {
    renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "stakwork-run-update",
    )?.[1];

    expect(handler).toBeDefined();

    act(() => {
      handler({ runId: "runner-abc", status: "SCORING" });
    });

    await waitFor(() => {
      // Two more calls (one per type) for the refetch
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
  });

  it("refetches when STAKWORK_RUN_UPDATE event has matching sibling scorer id", async () => {
    renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "stakwork-run-update",
    )?.[1];

    act(() => {
      handler({ runId: "scorer-abc", status: "COMPLETED" });
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
  });

  it("also refetches when Pusher event uses legacy run_id field with matching value", async () => {
    renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "stakwork-run-update",
    )?.[1];

    act(() => {
      handler({ run_id: "runner-abc", status: "SCORING" });
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
  });

  it("does NOT refetch when Pusher event has non-matching runId", async () => {
    renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "stakwork-run-update",
    )?.[1];

    act(() => {
      handler({ runId: "completely-different-run", status: "SCORING" });
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("sets isStale after 3-minute timeout when composite status is in-progress", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isStale).toBe(false);

    // Advance past 3 minutes — stale poll fires
    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000 + 100);
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(result.current.isStale).toBe(true);
  });

  it("resets isStale when composite status advances to a terminal state via Pusher", async () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await act(async () => { await Promise.resolve(); });

    // Trigger stale state
    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000 + 100);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(result.current.isStale).toBe(true);

    // Now simulate COMPLETED update via Pusher
    setupFetchWithPair({ status: "COMPLETED" }, { status: "COMPLETED" });

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "stakwork-run-update",
    )?.[1];

    await act(async () => {
      // "complete" is a terminal composite status (not in IN_PROGRESS_STATUSES)
      handler({ runId: "runner-abc", status: "complete" });
      await Promise.resolve();
    });

    // isStale cleared synchronously in the handler before async fetch
    expect(result.current.isStale).toBe(false);
  });

  it("handles Pusher not configured gracefully", async () => {
    const pusherLib = await import("@/lib/pusher");
    vi.mocked(pusherLib.getPusherClient).mockImplementationOnce(() => {
      throw new Error("Pusher not configured");
    });

    expect(() => {
      renderHook(() => useLegalBenchmarkRun(runId));
    }).not.toThrow();
  });

  it("handles fetch error gracefully", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.run).toBeNull();
  });

  it("returns null run when runner row is not found in the response", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ runs: [] }),
    } as Response);

    const { result } = renderHook(() => useLegalBenchmarkRun("nonexistent-id"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.run).toBeNull();
  });
});
