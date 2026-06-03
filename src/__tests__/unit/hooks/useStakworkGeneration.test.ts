import { renderHook, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useStakworkGeneration } from "@/hooks/useStakworkGeneration";

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
  slug: "test-workspace",
};

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(() => ({ workspace: mockWorkspace })),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => mockPusherClient),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

global.fetch = vi.fn();

const STALE_RUN_TIMEOUT_MS = 10 * 60 * 1000; // must match hook constant

describe("useStakworkGeneration", () => {
  const featureId = "feature-123";
  const type = "ARCHITECTURE";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ runs: [] }),
    } as Response);
  });

  describe("error handling", () => {
    it("should handle getPusherClient throwing error gracefully", async () => {
      const pusher = await import("@/lib/pusher");
      
      // Mock getPusherClient to throw
      vi.mocked(pusher.getPusherClient).mockImplementation(() => {
        throw new Error("Pusher environment variables are not configured");
      });

      // Hook should render without error
      expect(() => {
        renderHook(() =>
          useStakworkGeneration({
            featureId,
            type: type as "ARCHITECTURE",
            enabled: true,
          })
        );
      }).not.toThrow();

      // No subscription should be attempted
      expect(mockPusherClient.subscribe).not.toHaveBeenCalled();
      expect(mockChannel.bind).not.toHaveBeenCalled();
    });
  });

  describe("isStale", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function makeRun(status: string, ageMs = 0): object {
      return {
        id: "run-1",
        type: "TASK_GENERATION",
        status,
        result: null,
        dataType: "json",
        decision: null,
        feedback: null,
        featureId,
        projectId: null,
        createdAt: new Date(Date.now() - ageMs).toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    it("isStale is false when latestRun is null", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: [] }),
      } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      await waitFor(() => expect(result.current.querying).toBe(false));
      expect(result.current.isStale).toBe(false);
    });

    it("isStale is false for a completed run", async () => {
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: [makeRun("COMPLETED")] }),
      } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      await waitFor(() => expect(result.current.querying).toBe(false));
      // COMPLETED runs have a decision so latestRun is null (filtered out)
      expect(result.current.isStale).toBe(false);
    });

    it("isStale is false for a fresh IN_PROGRESS run", async () => {
      vi.useFakeTimers();

      const freshRun = makeRun("IN_PROGRESS", 0); // just started
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: [freshRun] }),
      } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      await act(async () => {
        await Promise.resolve();
      });

      // Before timeout elapses, isStale should be false
      expect(result.current.isStale).toBe(false);

      vi.useRealTimers();
    });

    it("isStale becomes true after STALE_RUN_TIMEOUT_MS for an IN_PROGRESS run", async () => {
      vi.useFakeTimers();

      const freshRun = makeRun("IN_PROGRESS", 0);
      // First fetch: fresh IN_PROGRESS run; second fetch (poll): still IN_PROGRESS
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [freshRun] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [makeRun("IN_PROGRESS", STALE_RUN_TIMEOUT_MS + 1000)] }),
        } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isStale).toBe(false);

      // Advance past the timeout — timer fires and triggers poll
      await act(async () => {
        vi.advanceTimersByTime(STALE_RUN_TIMEOUT_MS + 1000);
        await Promise.resolve();
      });

      // After poll returns still-IN_PROGRESS, second pass marks stale
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isStale).toBe(true);
    });

    it("isStale becomes true after STALE_RUN_TIMEOUT_MS for a PENDING run", async () => {
      vi.useFakeTimers();

      const pendingRun = makeRun("PENDING", 0);
      // First fetch: fresh PENDING run; second fetch (poll): still PENDING
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [pendingRun] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [makeRun("PENDING", STALE_RUN_TIMEOUT_MS + 1000)] }),
        } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isStale).toBe(false);

      // Advance past the timeout — timer fires and triggers poll
      await act(async () => {
        vi.advanceTimersByTime(STALE_RUN_TIMEOUT_MS + 1000);
        await Promise.resolve();
      });

      // After poll returns still-PENDING, second pass marks stale
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isStale).toBe(true);
    });

    it("isStale is immediately true for an already-old IN_PROGRESS run", async () => {
      const oldRun = makeRun("IN_PROGRESS", STALE_RUN_TIMEOUT_MS + 5000); // already past timeout
      // First fetch: old IN_PROGRESS run; second fetch (poll): still IN_PROGRESS
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [oldRun] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [makeRun("IN_PROGRESS", STALE_RUN_TIMEOUT_MS + 5000)] }),
        } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      // Wait for initial fetch, then poll, then second-pass evaluation
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(result.current.isStale).toBe(true));
    });

    it("isStale resets to false when latestRun transitions out of IN_PROGRESS", async () => {
      vi.useFakeTimers();

      const inProgressRun = makeRun("IN_PROGRESS", 0);
      // First fetch: fresh IN_PROGRESS; second fetch (poll): still IN_PROGRESS; third fetch (refetch): resolved
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [inProgressRun] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [makeRun("IN_PROGRESS", STALE_RUN_TIMEOUT_MS + 1000)] }),
        } as Response)
        .mockResolvedValue({
          ok: true,
          json: async () => ({ runs: [] }),
        } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      await act(async () => {
        await Promise.resolve();
      });

      // Advance past timeout — timer fires and triggers poll
      await act(async () => {
        vi.advanceTimersByTime(STALE_RUN_TIMEOUT_MS + 1000);
        await Promise.resolve();
      });

      // After poll returns still-IN_PROGRESS, second pass marks stale
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isStale).toBe(true);

      // Now simulate the run being resolved (decision set → latestRun becomes null)
      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.latestRun).toBeNull();
      expect(result.current.isStale).toBe(false);
    });

    it("timer fires → backend returns COMPLETED → isStale stays false", async () => {
      vi.useFakeTimers();

      const freshRun = makeRun("IN_PROGRESS", 0);
      // First fetch: fresh IN_PROGRESS run; second fetch (poll): COMPLETED (no decision, so filtered — returns empty)
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [freshRun] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [] }), // completed run has decision, filtered to null
        } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isStale).toBe(false);

      // Advance past the timeout — timer fires and triggers poll
      await act(async () => {
        vi.advanceTimersByTime(STALE_RUN_TIMEOUT_MS + 1000);
        await Promise.resolve();
      });

      // Poll returns empty (completed) → latestRun becomes null → isStale resets to false
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isStale).toBe(false);
    });

    it("run already old on mount → backend returns COMPLETED on poll → isStale stays false", async () => {
      const oldRun = makeRun("IN_PROGRESS", STALE_RUN_TIMEOUT_MS + 5000);
      // First fetch: old IN_PROGRESS run; second fetch (poll): empty (completed/decided)
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [oldRun] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [] }),
        } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      // Wait for initial fetch + poll + second-pass evaluation
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(result.current.querying).toBe(false));
      expect(result.current.isStale).toBe(false);
    });

    it("poll fetch throws → isStale stays false (silent degradation)", async () => {
      const oldRun = makeRun("IN_PROGRESS", STALE_RUN_TIMEOUT_MS + 5000);
      // First fetch: old IN_PROGRESS run; second fetch (poll): network error
      vi.mocked(global.fetch)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ runs: [oldRun] }),
        } as Response)
        .mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      // Wait for initial fetch + failed poll (silently caught)
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(result.current.querying).toBe(false));
      // Poll failed silently — latestRun unchanged, effect doesn't re-run → isStale stays false
      expect(result.current.isStale).toBe(false);
    });
  });
});
