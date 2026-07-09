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
  }),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** Helper: set up fetch to return the runner row (single-run pipeline). */
function setupFetch(runnerOverrides: Partial<typeof MOCK_RUNNER_ROW> = {}) {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ runs: [{ ...MOCK_RUNNER_ROW, ...runnerOverrides }] }),
  } as Response);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useLegalBenchmarkRun", () => {
  const runId = "runner-abc";

  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setupFetch();
  });

  it("fires a single fetch against /api/stakwork/runs for LEGAL_BENCHMARK_RUNNER only", async () => {
    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Exactly one call — no scorer fetch
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain("LEGAL_BENCHMARK_RUNNER");
    expect(url).not.toContain("LEGAL_BENCHMARK_SCORER");
    expect(url).toContain("workspace-123");
  });

  it("sets isLoading to true initially, false after fetch", async () => {
    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("derives running status when runner is IN_PROGRESS", async () => {
    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run!.status).toBe("running");
    expect(result.current.run!.id).toBe("runner-abc");
    expect(result.current.run!.taskSlug).toBe("antitrust/task-1");
  });

  it("derives complete status when runner is COMPLETED", async () => {
    setupFetch({ status: "COMPLETED" });

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run!.status).toBe("complete");
  });

  it("surfaces flat score fields from runner result when COMPLETED", async () => {
    setupFetch({
      status: "COMPLETED",
      result: JSON.stringify({
        taskSlug: "antitrust/task-1",
        taskTitle: "Analyze Antitrust Strategy",
        n_passed: 72,
        n_total: 74,
        all_pass: true,
        pass_rate: 0.97,
        judge_model: "gpt-4o",
      }),
    });

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run!.status).toBe("complete");
    expect(result.current.run!.runnerRun.result?.n_passed).toBe(72);
    expect(result.current.run!.runnerRun.result?.n_total).toBe(74);
    expect(result.current.run!.runnerRun.result?.all_pass).toBe(true);
  });

  it("derives failed status when runner is FAILED", async () => {
    setupFetch({ status: "FAILED" });

    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run!.status).toBe("failed");
  });

  it("scorerRun is always null (single-run pipeline)", async () => {
    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run!.scorerRun).toBeNull();
  });

  it("scoreJson is always null (flat fields on runnerRun.result instead)", async () => {
    setupFetch({ status: "COMPLETED" });
    const { result } = renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(result.current.run).not.toBeNull();
    });

    expect(result.current.run!.scoreJson).toBeNull();
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
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "stakwork-run-update",
    )?.[1];

    expect(handler).toBeDefined();

    act(() => {
      handler({ runId: "runner-abc", status: "COMPLETED" });
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it("also refetches when Pusher event uses legacy run_id field with matching value", async () => {
    renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "stakwork-run-update",
    )?.[1];

    act(() => {
      handler({ run_id: "runner-abc", status: "COMPLETED" });
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it("does NOT refetch when Pusher event has non-matching runId", async () => {
    renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "stakwork-run-update",
    )?.[1];

    act(() => {
      handler({ runId: "completely-different-run", status: "COMPLETED" });
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT refetch when Pusher event matches a scorer id (scorer no longer tracked)", async () => {
    renderHook(() => useLegalBenchmarkRun(runId));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "stakwork-run-update",
    )?.[1];

    act(() => {
      handler({ runId: "scorer-abc", status: "COMPLETED" });
    });

    await new Promise((r) => setTimeout(r, 50));
    // No refetch since "scorer-abc" !== "runner-abc"
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("sets isStale after 3-minute timeout when status is running", async () => {
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

  it("resets isStale when status advances to a terminal state via Pusher", async () => {
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
    setupFetch({ status: "COMPLETED" });

    const handler = mockChannel.bind.mock.calls.find(
      ([event]) => event === "stakwork-run-update",
    )?.[1];

    await act(async () => {
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
