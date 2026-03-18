import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWorkflowPolling, TERMINAL_STATUSES } from "@/hooks/useWorkflowPolling";

describe("useWorkflowPolling", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function makeResponse(status: string) {
    return {
      ok: true,
      json: async () => ({
        status,
        workflowData: { transitions: [], connections: [] },
        current_transition_completion: 0,
      }),
    };
  }

  it("exports TERMINAL_STATUSES with all expected values", () => {
    expect(TERMINAL_STATUSES).toEqual(
      expect.arrayContaining(["completed", "failed", "error", "halted", "paused", "stopped"])
    );
    expect(TERMINAL_STATUSES).toHaveLength(6);
  });

  describe("stops polling for each terminal status", () => {
    for (const terminalStatus of TERMINAL_STATUSES) {
      it(`stops polling when status is "${terminalStatus}"`, async () => {
        mockFetch.mockResolvedValue(makeResponse(terminalStatus));

        const { result } = renderHook(() =>
          useWorkflowPolling("proj-123", true, 1000)
        );

        // Flush the initial fetch and resulting state updates
        await act(async () => {
          await Promise.resolve();
          await Promise.resolve();
        });

        // State should be settled after microtask flush — no waitFor needed with fake timers
        expect(result.current.workflowData?.status).toBe(terminalStatus);

        // Interval should be cleared — advance timers and confirm no extra fetches
        const callCountAfterTerminal = mockFetch.mock.calls.length;
        await act(async () => {
          vi.advanceTimersByTime(3000);
          await Promise.resolve();
        });

        expect(mockFetch.mock.calls.length).toBe(callCountAfterTerminal);
      });
    }
  });

  it("continues polling for non-terminal status 'running'", async () => {
    mockFetch.mockResolvedValue(makeResponse("running"));

    renderHook(() => useWorkflowPolling("proj-123", true, 500));

    // Initial fetch
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance past two intervals — should trigger more fetches
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
    });

    expect(mockFetch.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not start polling when isActive is false", async () => {
    mockFetch.mockResolvedValue(makeResponse("running"));

    renderHook(() => useWorkflowPolling("proj-123", false, 500));

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not start polling when projectId is null", async () => {
    mockFetch.mockResolvedValue(makeResponse("running"));

    renderHook(() => useWorkflowPolling(null, true, 500));

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not start polling when workflowData is already in a terminal state", async () => {
    // First call returns a terminal status
    mockFetch.mockResolvedValueOnce(makeResponse("completed"));

    const { result } = renderHook(() =>
      useWorkflowPolling("proj-123", true, 500)
    );

    // Flush the initial fetch and resulting state updates
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // State should be settled after microtask flush — no waitFor needed with fake timers
    expect(result.current.workflowData?.status).toBe("completed");

    const callCount = mockFetch.mock.calls.length;

    // Advance timers — no further polling should occur
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(mockFetch.mock.calls.length).toBe(callCount);
  });
});
