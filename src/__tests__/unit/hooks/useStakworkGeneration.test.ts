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

      expect(result.current.isStale).toBe(false);

      // Advance past the timeout
      act(() => {
        vi.advanceTimersByTime(STALE_RUN_TIMEOUT_MS + 1000);
      });

      expect(result.current.isStale).toBe(true);
    });

    it("isStale becomes true after STALE_RUN_TIMEOUT_MS for a PENDING run", async () => {
      vi.useFakeTimers();

      const pendingRun = makeRun("PENDING", 0);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: [pendingRun] }),
      } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.isStale).toBe(false);

      act(() => {
        vi.advanceTimersByTime(STALE_RUN_TIMEOUT_MS + 1000);
      });

      expect(result.current.isStale).toBe(true);
    });

    it("isStale is immediately true for an already-old IN_PROGRESS run", async () => {
      const oldRun = makeRun("IN_PROGRESS", STALE_RUN_TIMEOUT_MS + 5000); // already past timeout
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: [oldRun] }),
      } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      await waitFor(() => expect(result.current.querying).toBe(false));
      expect(result.current.isStale).toBe(true);
    });

    it("isStale resets to false when latestRun transitions out of IN_PROGRESS", async () => {
      vi.useFakeTimers();

      const inProgressRun = makeRun("IN_PROGRESS", 0);
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: [inProgressRun] }),
      } as Response);

      const { result } = renderHook(() =>
        useStakworkGeneration({ featureId, type: "TASK_GENERATION", enabled: true })
      );

      await act(async () => {
        await Promise.resolve();
      });

      // Advance past timeout → isStale = true
      act(() => {
        vi.advanceTimersByTime(STALE_RUN_TIMEOUT_MS + 1000);
      });
      expect(result.current.isStale).toBe(true);

      // Now simulate the run being resolved (decision set → latestRun becomes null)
      vi.mocked(global.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: [] }),
      } as Response);

      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.latestRun).toBeNull();
      expect(result.current.isStale).toBe(false);
    });
  });
});
