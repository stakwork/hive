/**
 * Unit tests for useWorkflowLogs hook
 *
 * Covers:
 * - Fetches by task_id when only taskId provided
 * - Fetches by feature_id when only featureId provided
 * - Both fetches fire when both IDs provided; results deduplicated by id
 * - Logs sorted ascending by createdAt after merge
 * - upsertLog from task channel updates merged list and bumps lastUpdated
 * - upsertLog from feature channel updates merged list and bumps lastUpdated
 * - Duplicate log arriving from both channels is not doubled
 * - Plan-mode degradation: taskId=null → single fetch, single channel only
 * - Reset on both IDs going null clears state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// ── Pusher mock ───────────────────────────────────────────────────────────────

const mockBind = vi.fn();
const mockUnbind = vi.fn();
const mockChannel = { bind: mockBind, unbind: mockUnbind, unbind_all: vi.fn() };
const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
  disconnect: vi.fn(),
};

// We track channel subscriptions via usePusherChannel — mock it directly
// so we can exercise bind/unbind without a real Pusher connection.
type ChannelLike = { bind: (event: string, handler: (e: unknown) => void) => void; unbind: (event: string, handler: (e: unknown) => void) => void };
const channelMap = new Map<string, ChannelLike>();
const mockUsePusherChannel = vi.fn((name: string | null) => {
  if (!name) return null;
  if (!channelMap.has(name)) {
    channelMap.set(name, { bind: mockBind, unbind: mockUnbind });
  }
  return channelMap.get(name)!;
});

vi.mock("@/hooks/usePusherChannel", () => ({
  usePusherChannel: (name: string | null) => mockUsePusherChannel(name),
  __resetUsePusherChannelForTests: vi.fn(),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => mockPusherClient),
  getTaskChannelName: vi.fn((id: string) => `task-${id}`),
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  getWorkspaceChannelName: vi.fn((id: string) => `workspace-${id}`),
  PUSHER_EVENTS: {
    AGENT_LOG_UPDATED: "agent-log-updated",
  },
}));

// ── fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ── hook under test ───────────────────────────────────────────────────────────

import { useWorkflowLogs } from "@/hooks/useWorkflowLogs";
import type { AgentLogUpdateEvent } from "@/hooks/usePusherConnection";

// Helper: get a registered AGENT_LOG_UPDATED handler from bind calls
function getBindHandler(callIndex?: number): ((event: AgentLogUpdateEvent) => void) | undefined {
  const calls = mockBind.mock.calls as Array<[string, (event: AgentLogUpdateEvent) => void]>;
  const logCalls = calls.filter(([event]) => event === "agent-log-updated");
  const idx = callIndex ?? logCalls.length - 1;
  return logCalls[idx]?.[1];
}

function makeFetchResponse(data: { id: string; agent: string; createdAt: string }[]) {
  return {
    ok: true,
    json: async () => ({ data, total: data.length, hasMore: false }),
  };
}

describe("useWorkflowLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    channelMap.clear();
  });

  afterEach(() => {
    channelMap.clear();
  });

  // ── Fetch behaviour ───────────────────────────────────────────────────────

  it("fetches by task_id when only taskId is provided", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse([{ id: "log-t1", agent: "coder-agent", createdAt: "2026-05-28T10:00:00Z" }])
    );

    const { result } = renderHook(() => useWorkflowLogs("task-1", null, "ws-1"));

    await waitFor(() => expect(result.current.agentLogs).toHaveLength(1));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/agent-logs?task_id=task-1&workspace_id=ws-1&limit=20"
    );
    expect(result.current.agentLogs[0].id).toBe("log-t1");
  });

  it("fetches by feature_id when only featureId is provided (plan-mode degradation)", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse([{ id: "log-f1", agent: "plan-agent", createdAt: "2026-05-28T09:00:00Z" }])
    );

    const { result } = renderHook(() => useWorkflowLogs(null, "feat-1", "ws-1"));

    await waitFor(() => expect(result.current.agentLogs).toHaveLength(1));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/agent-logs?feature_id=feat-1&workspace_id=ws-1&limit=20"
    );
    expect(result.current.agentLogs[0].id).toBe("log-f1");
  });

  it("fires both fetches when both taskId and featureId are provided", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeFetchResponse([{ id: "log-t1", agent: "coder-agent", createdAt: "2026-05-28T10:00:00Z" }])
      )
      .mockResolvedValueOnce(
        makeFetchResponse([{ id: "log-f1", agent: "plan-agent", createdAt: "2026-05-28T09:00:00Z" }])
      );

    const { result } = renderHook(() => useWorkflowLogs("task-1", "feat-1", "ws-1"));

    await waitFor(() => expect(result.current.agentLogs).toHaveLength(2));

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates logs by id when same log appears in both responses", async () => {
    const sharedLog = { id: "log-shared", agent: "coder-agent", createdAt: "2026-05-28T10:00:00Z" };
    mockFetch
      .mockResolvedValueOnce(makeFetchResponse([sharedLog]))
      .mockResolvedValueOnce(makeFetchResponse([sharedLog]));

    const { result } = renderHook(() => useWorkflowLogs("task-1", "feat-1", "ws-1"));

    await waitFor(() => expect(result.current.agentLogs).toHaveLength(1));
    expect(result.current.agentLogs[0].id).toBe("log-shared");
  });

  it("sorts merged logs ascending by createdAt", async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeFetchResponse([{ id: "log-late", agent: "coder", createdAt: "2026-05-28T11:00:00Z" }])
      )
      .mockResolvedValueOnce(
        makeFetchResponse([{ id: "log-early", agent: "planner", createdAt: "2026-05-28T08:00:00Z" }])
      );

    const { result } = renderHook(() => useWorkflowLogs("task-1", "feat-1", "ws-1"));

    await waitFor(() => expect(result.current.agentLogs).toHaveLength(2));

    expect(result.current.agentLogs[0].id).toBe("log-early");
    expect(result.current.agentLogs[1].id).toBe("log-late");
  });

  it("does not fetch when workspaceId is null", () => {
    renderHook(() => useWorkflowLogs("task-1", null, null));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not fetch when both taskId and featureId are null", () => {
    renderHook(() => useWorkflowLogs(null, null, "ws-1"));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Pusher subscriptions ──────────────────────────────────────────────────

  it("subscribes only to task channel in task-only mode", async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse([]));

    renderHook(() => useWorkflowLogs("task-1", null, "ws-1"));

    await waitFor(() => {
      expect(mockUsePusherChannel).toHaveBeenCalledWith("task-task-1");
    });
    // feature channel called with null
    expect(mockUsePusherChannel).toHaveBeenCalledWith(null);
  });

  it("subscribes only to feature channel in plan-mode (taskId null)", async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse([]));

    renderHook(() => useWorkflowLogs(null, "feat-1", "ws-1"));

    await waitFor(() => {
      expect(mockUsePusherChannel).toHaveBeenCalledWith("feature-feat-1");
    });
    expect(mockUsePusherChannel).toHaveBeenCalledWith(null);
  });

  it("subscribes to both channels when both IDs provided", async () => {
    mockFetch.mockResolvedValue(makeFetchResponse([]));

    renderHook(() => useWorkflowLogs("task-1", "feat-1", "ws-1"));

    await waitFor(() => {
      expect(mockUsePusherChannel).toHaveBeenCalledWith("task-task-1");
      expect(mockUsePusherChannel).toHaveBeenCalledWith("feature-feat-1");
    });
  });

  // ── Pusher upsert behaviour ───────────────────────────────────────────────

  it("inserts a new log when AGENT_LOG_UPDATED fires with a new id", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse([{ id: "log-a", agent: "plan-agent", createdAt: "2026-05-28T09:00:00Z" }])
    );

    const { result } = renderHook(() => useWorkflowLogs("task-1", null, "ws-1"));

    await waitFor(() => expect(result.current.agentLogs).toHaveLength(1));

    const handler = getBindHandler();
    expect(handler).toBeDefined();

    act(() => {
      handler!({ id: "log-b", agent: "coder-agent", createdAt: "2026-05-28T10:00:00Z", isNew: true });
    });

    expect(result.current.agentLogs).toHaveLength(2);
    expect(result.current.agentLogs[0].id).toBe("log-a");
    expect(result.current.agentLogs[1].id).toBe("log-b");
  });

  it("upserts in-place when AGENT_LOG_UPDATED fires for an existing id", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse([
        { id: "log-a", agent: "plan-agent", createdAt: "2026-05-28T09:00:00Z" },
        { id: "log-b", agent: "coder-agent", createdAt: "2026-05-28T10:00:00Z" },
      ])
    );

    const { result } = renderHook(() => useWorkflowLogs("task-1", null, "ws-1"));

    await waitFor(() => expect(result.current.agentLogs).toHaveLength(2));

    const handler = getBindHandler();

    act(() => {
      handler!({ id: "log-a", agent: "plan-agent-updated", createdAt: "2026-05-28T09:00:00Z", isNew: false });
    });

    expect(result.current.agentLogs).toHaveLength(2);
    expect(result.current.agentLogs[0].agent).toBe("plan-agent-updated");
  });

  it("bumps lastUpdated[id] on every Pusher event", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse([{ id: "log-a", agent: "plan-agent", createdAt: "2026-05-28T09:00:00Z" }])
    );

    const { result } = renderHook(() => useWorkflowLogs("task-1", null, "ws-1"));

    await waitFor(() => expect(result.current.agentLogs).toHaveLength(1));

    const handler = getBindHandler();
    const before = Date.now();

    act(() => {
      handler!({ id: "log-a", agent: "plan-agent", createdAt: "2026-05-28T09:00:00Z", isNew: false });
    });

    expect(result.current.lastUpdated["log-a"]).toBeGreaterThanOrEqual(before);
  });

  it("does not double a log that arrives via both task and feature channels", async () => {
    // Setup: two channels both return the same log via Pusher
    mockFetch
      .mockResolvedValueOnce(makeFetchResponse([]))
      .mockResolvedValueOnce(makeFetchResponse([]));

    const { result } = renderHook(() => useWorkflowLogs("task-1", "feat-1", "ws-1"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    const handlers = (mockBind.mock.calls as Array<[string, (event: AgentLogUpdateEvent) => void]>)
      .filter(([event]) => event === "agent-log-updated")
      .map(([, fn]) => fn);

    // Both channels receive the same log event
    const sharedEvent: AgentLogUpdateEvent = {
      id: "log-shared",
      agent: "coder-agent",
      createdAt: "2026-05-28T10:00:00Z",
      isNew: true,
    };

    act(() => {
      handlers[0]?.(sharedEvent);
    });
    act(() => {
      handlers[1]?.(sharedEvent);
    });

    // Should only have one entry despite two events with the same id
    expect(result.current.agentLogs).toHaveLength(1);
    expect(result.current.agentLogs[0].id).toBe("log-shared");
  });

  // ── Reset behaviour ───────────────────────────────────────────────────────

  it("clears state when both taskId and featureId become null", async () => {
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse([{ id: "log-a", agent: "plan-agent", createdAt: "2026-05-28T09:00:00Z" }])
    );

    const { result, rerender } = renderHook(
      ({ taskId, featureId }: { taskId: string | null; featureId: string | null }) =>
        useWorkflowLogs(taskId, featureId, "ws-1"),
      { initialProps: { taskId: "task-1", featureId: null } }
    );

    await waitFor(() => expect(result.current.agentLogs).toHaveLength(1));

    act(() => {
      rerender({ taskId: null, featureId: null });
    });

    expect(result.current.agentLogs).toHaveLength(0);
    expect(result.current.lastUpdated).toEqual({});
  });
});
