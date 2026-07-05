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
    LEGAL_BENCHMARK_UPDATE: "legal-benchmark-update",
  },
}));

global.fetch = vi.fn();

const MOCK_RUN = {
  id: "run-abc",
  workspaceId: "workspace-123",
  taskSlug: "antitrust/task-1",
  taskTitle: "Analyze Antitrust Strategy",
  status: "RUNNING",
  runnerProjectId: null,
  scorerProjectId: null,
  runnerOutputUrl: null,
  runnerOutputText: null,
  scoreJson: null,
  errorMessage: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useLegalBenchmarkRun", () => {
  const runId = "run-abc";

  afterEach(() => {
    // Always restore real timers so timer leakage doesn't affect subsequent tests.
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ run: MOCK_RUN }),
    } as Response);
  });

  it("fires initial fetch on mount", async () => {
    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/workspaces/openlaw/legal/benchmarks/runs/${runId}`
    );
    expect(result.current.run).toEqual(MOCK_RUN);
  });

  it("sets isLoading to true initially, false after fetch", async () => {
    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("subscribes to Pusher channel on mount", async () => {
    renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(mockPusherClient.subscribe).toHaveBeenCalledWith("workspace-openlaw");
      expect(mockChannel.bind).toHaveBeenCalledWith(
        "legal-benchmark-update",
        expect.any(Function)
      );
    });
  });

  it("refetches when Pusher event has matching run_id", async () => {
    renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Get the bound handler
    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "legal-benchmark-update"
    )?.[1];

    expect(handler).toBeDefined();

    // Fire event with matching run_id
    act(() => {
      handler({ run_id: runId, status: "SCORING" });
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it("does NOT refetch when Pusher event has non-matching run_id", async () => {
    renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "legal-benchmark-update"
    )?.[1];

    // Fire event with different run_id
    act(() => {
      handler({ run_id: "different-run-id", status: "SCORING" });
    });

    // Should still only have been called once
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("sets isStale after 3-minute timeout when status is in-progress", async () => {
    vi.useFakeTimers();

    const staleRun = {
      ...MOCK_RUN,
      status: "RUNNING",
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ run: staleRun }),
    } as Response);

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isStale).toBe(false);

    // Advance past 3 minutes — first poll fires
    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000 + 100);
      await Promise.resolve();
    });

    // Second pass sets isStale
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(result.current.isStale).toBe(true);

    vi.useRealTimers();
  });

  it("resets isStale when status advances to a terminal state", async () => {
    vi.useFakeTimers();

    const staleRun = {
      ...MOCK_RUN,
      status: "RUNNING",
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ run: staleRun }),
    } as Response);

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await act(async () => { await Promise.resolve(); });

    // Trigger stale state via two poll cycles
    await act(async () => {
      vi.advanceTimersByTime(3 * 60 * 1000 + 100);
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(result.current.isStale).toBe(true);

    // Now simulate a COMPLETE status update via Pusher
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ run: { ...staleRun, status: "COMPLETE" } }),
    } as Response);

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "legal-benchmark-update"
    )?.[1];

    await act(async () => {
      handler({ run_id: runId, status: "COMPLETE" });
      await Promise.resolve();
    });

    // isStale is cleared synchronously in the Pusher handler before the async
    // fetch, so we can assert directly without waitFor (which uses real timers
    // and hangs inside vi.useFakeTimers()).
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
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.run).toBeNull();
  });
});
