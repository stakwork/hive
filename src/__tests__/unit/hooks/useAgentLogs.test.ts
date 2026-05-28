/**
 * Unit tests for useAgentLogs hook
 *
 * Covers:
 * - Initial fetch on mount
 * - Ascending sort by createdAt
 * - Upsert-in-place when an existing log is updated
 * - Insert-new when a new log arrives
 * - lastUpdated bump on every upsert/insert
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// ── Pusher mock ───────────────────────────────────────────────────────────────
const mockBind = vi.fn();
const mockUnbindAll = vi.fn();
const mockChannel = { bind: mockBind, unbind_all: mockUnbindAll, unbind: vi.fn() };
const mockPusherClient = {
  subscribe: vi.fn(() => mockChannel),
  unsubscribe: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock("@/lib/pusher", () => ({
  getPusherClient: vi.fn(() => mockPusherClient),
  getTaskChannelName: vi.fn((id: string) => `task-${id}`),
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  getWorkspaceChannelName: vi.fn((id: string) => `workspace-${id}`),
  PUSHER_EVENTS: {
    NEW_MESSAGE: "new-message",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    TASK_TITLE_UPDATE: "task-title-update",
    PR_STATUS_CHANGE: "pr-status-change",
    BOUNTY_STATUS_CHANGE: "bounty-status-change",
    DEPLOYMENT_STATUS_CHANGE: "deployment-status-change",
    FEATURE_UPDATED: "feature-updated",
    FEATURE_TITLE_UPDATE: "feature-title-update",
    RECOMMENDATIONS_UPDATED: "recommendations-updated",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
    AGENT_LOG_UPDATED: "agent-log-updated",
  },
}));

// ── fetch mock ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ── hook under test ───────────────────────────────────────────────────────────
import { useAgentLogs } from "@/hooks/useAgentLogs";
import type { AgentLogUpdateEvent } from "@/hooks/usePusherConnection";

// Helper: get the callback registered for AGENT_LOG_UPDATED
function getAgentLogUpdateHandler(): ((event: AgentLogUpdateEvent) => void) | undefined {
  const calls = mockBind.mock.calls as Array<[string, (event: AgentLogUpdateEvent) => void]>;
  const call = calls.find(([event]) => event === "agent-log-updated");
  return call?.[1];
}

describe("useAgentLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches agent logs on mount and sorts ascending by createdAt", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: "log-b", agent: "coder-agent-x", createdAt: "2026-05-28T10:00:00Z" },
          { id: "log-a", agent: "plan-agent-x", createdAt: "2026-05-28T09:00:00Z" },
        ],
        total: 2,
        hasMore: false,
      }),
    });

    const { result } = renderHook(() => useAgentLogs("feat-1", "ws-1"));

    await waitFor(() => {
      expect(result.current.agentLogs).toHaveLength(2);
    });

    // ascending order: log-a before log-b
    expect(result.current.agentLogs[0].id).toBe("log-a");
    expect(result.current.agentLogs[1].id).toBe("log-b");
  });

  it("calls the correct API endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], total: 0, hasMore: false }),
    });

    renderHook(() => useAgentLogs("feat-99", "ws-42"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/agent-logs?feature_id=feat-99&workspace_id=ws-42&limit=20"
      );
    });
  });

  it("does not fetch when featureId is null", () => {
    renderHook(() => useAgentLogs(null, "ws-1"));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not fetch when workspaceId is null", () => {
    renderHook(() => useAgentLogs("feat-1", null));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("inserts a new log when AGENT_LOG_UPDATED fires with a new id", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: "log-a", agent: "plan-agent-x", createdAt: "2026-05-28T09:00:00Z" }],
        total: 1,
        hasMore: false,
      }),
    });

    const { result } = renderHook(() => useAgentLogs("feat-1", "ws-1"));

    await waitFor(() => {
      expect(result.current.agentLogs).toHaveLength(1);
    });

    const handler = getAgentLogUpdateHandler();
    expect(handler).toBeDefined();

    act(() => {
      handler!({
        id: "log-b",
        agent: "coder-agent-x",
        createdAt: "2026-05-28T10:00:00Z",
        isNew: true,
      });
    });

    expect(result.current.agentLogs).toHaveLength(2);
    expect(result.current.agentLogs[0].id).toBe("log-a");
    expect(result.current.agentLogs[1].id).toBe("log-b");
  });

  it("upserts in-place when AGENT_LOG_UPDATED fires for an existing id", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: "log-a", agent: "plan-agent-x", createdAt: "2026-05-28T09:00:00Z" },
          { id: "log-b", agent: "coder-agent-x", createdAt: "2026-05-28T10:00:00Z" },
        ],
        total: 2,
        hasMore: false,
      }),
    });

    const { result } = renderHook(() => useAgentLogs("feat-1", "ws-1"));

    await waitFor(() => {
      expect(result.current.agentLogs).toHaveLength(2);
    });

    const handler = getAgentLogUpdateHandler();

    act(() => {
      handler!({
        id: "log-a",
        agent: "plan-agent-updated",
        createdAt: "2026-05-28T09:00:00Z",
        isNew: false,
      });
    });

    // Still 2 entries — no duplicate
    expect(result.current.agentLogs).toHaveLength(2);
    expect(result.current.agentLogs[0].agent).toBe("plan-agent-updated");
  });

  it("bumps lastUpdated[id] on every Pusher event", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: "log-a", agent: "plan-agent-x", createdAt: "2026-05-28T09:00:00Z" }],
        total: 1,
        hasMore: false,
      }),
    });

    const { result } = renderHook(() => useAgentLogs("feat-1", "ws-1"));

    await waitFor(() => {
      expect(result.current.agentLogs).toHaveLength(1);
    });

    const handler = getAgentLogUpdateHandler();
    const before = Date.now();

    act(() => {
      handler!({ id: "log-a", agent: "plan-agent-x", createdAt: "2026-05-28T09:00:00Z", isNew: false });
    });

    expect(result.current.lastUpdated["log-a"]).toBeGreaterThanOrEqual(before);
  });

  it("re-sorts ascending after a new log is inserted", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: "log-c", agent: "coder-agent-x", createdAt: "2026-05-28T11:00:00Z" }],
        total: 1,
        hasMore: false,
      }),
    });

    const { result } = renderHook(() => useAgentLogs("feat-1", "ws-1"));

    await waitFor(() => {
      expect(result.current.agentLogs).toHaveLength(1);
    });

    const handler = getAgentLogUpdateHandler();

    act(() => {
      handler!({
        id: "log-a",
        agent: "plan-agent-x",
        createdAt: "2026-05-28T09:00:00Z",
        isNew: true,
      });
    });

    // log-a (09:00) should come before log-c (11:00)
    expect(result.current.agentLogs[0].id).toBe("log-a");
    expect(result.current.agentLogs[1].id).toBe("log-c");
  });
});
