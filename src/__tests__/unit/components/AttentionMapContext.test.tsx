/**
 * Unit tests for `AttentionMapContext` (`AttentionMapProvider` +
 * `useAttentionType`).
 *
 * Verifies:
 *   1. Initial fetch populates the map.
 *   2. `useAttentionType` returns `null` for unknown entities and the
 *      correct type for known ones.
 *   3. Interval poll re-fetches on schedule.
 *   4. A burst of Pusher-style events within the debounce window
 *      collapses into exactly one re-fetch.
 *   5. Workspace-level task-update events trigger a refresh.
 *   6. Per-entity events trigger a refresh.
 *   7. Graceful degradation when Pusher is unconfigured (null channel).
 */
import {
  describe,
  test,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import type { AttentionItem } from "@/services/attention/topItems";

// ---------------------------------------------------------------------------
// Mock channel factory
// ---------------------------------------------------------------------------

type Handler = () => void;

function makeMockChannel() {
  const handlers: Record<string, Handler[]> = {};
  return {
    bind: vi.fn((event: string, handler: Handler) => {
      handlers[event] = handlers[event] ?? [];
      handlers[event].push(handler);
    }),
    unbind: vi.fn((event: string, handler: Handler) => {
      if (handlers[event]) {
        handlers[event] = handlers[event].filter((h) => h !== handler);
      }
    }),
    _fire: (event: string) => {
      (handlers[event] ?? []).forEach((h) => h());
    },
  };
}

const wsChannelA = makeMockChannel();
const entityChannel = makeMockChannel();

// ---------------------------------------------------------------------------
// Mocks — must be at top level before imports
// ---------------------------------------------------------------------------

vi.mock("@/hooks/usePusherChannel", () => ({
  usePusherChannel: vi.fn((name: string | null) => {
    if (!name) return null;
    if (name.startsWith("workspace-")) return wsChannelA;
    return entityChannel;
  }),
}));

vi.mock("@/lib/pusher", () => ({
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getFeatureChannelName: (id: string) => `feature-${id}`,
  getTaskChannelName: (id: string) => `task-${id}`,
  PUSHER_EVENTS: {
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    FEATURE_UPDATED: "feature-updated",
    NEW_MESSAGE: "new-message",
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import {
  AttentionMapProvider,
  useAttentionType,
} from "@/app/org/[githubLogin]/connections/AttentionMapContext";
import { usePusherChannel } from "@/hooks/usePusherChannel";

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const makeItem = (
  entityKind: "feature" | "task",
  entityId: string,
  type: AttentionItem["type"],
): AttentionItem => ({
  id: `${type}:${entityKind}:${entityId}`,
  type,
  title: "Test item",
  workspaceSlug: "ws-alpha",
  workspaceName: "Alpha WS",
  entityKind,
  entityId,
  link: `/w/ws-alpha/${entityKind}/${entityId}`,
  ageMs: 5000,
  workspaceId: "ws-id-1",
});

// ---------------------------------------------------------------------------
// Setup / teardown — real timers so Promise-based fetch resolves normally.
// Tests that need timer control use vi.useFakeTimers() per-test.
// ---------------------------------------------------------------------------

beforeEach(() => {
  global.fetch = vi.fn();
  vi.clearAllMocks();
  // Restore usePusherChannel default after clearAllMocks
  vi.mocked(usePusherChannel).mockImplementation((name: string | null) => {
    if (!name) return null;
    if (name.startsWith("workspace-")) return wsChannelA;
    return entityChannel;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Wrapper factory
// ---------------------------------------------------------------------------

function makeWrapper(
  items: AttentionItem[],
  visibleWorkspaceSlugs = ["ws-alpha"],
) {
  (global.fetch as Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ items }),
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <AttentionMapProvider
        githubLogin="my-org"
        visibleWorkspaceSlugs={visibleWorkspaceSlugs}
      >
        {children}
      </AttentionMapProvider>
    );
  };
}

// Flushes all pending microtasks / promise callbacks
const flushPromises = () => act(async () => { await Promise.resolve(); });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AttentionMapProvider + useAttentionType", () => {
  test("initially returns null for unknown entity", async () => {
    const wrapper = makeWrapper([]);
    const { result } = renderHook(
      () => useAttentionType("feature", "unknown-id"),
      { wrapper },
    );
    await flushPromises();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
  });

  test("returns correct type after initial fetch", async () => {
    const items = [makeItem("feature", "feat-1", "halted")];
    const wrapper = makeWrapper(items);
    const { result } = renderHook(() => useAttentionType("feature", "feat-1"), {
      wrapper,
    });
    await flushPromises();
    expect(result.current).toBe("halted");
  });

  test("returns null for task when only feature item exists", async () => {
    const items = [makeItem("feature", "feat-1", "halted")];
    const wrapper = makeWrapper(items);
    const { result } = renderHook(() => useAttentionType("task", "feat-1"), {
      wrapper,
    });
    await flushPromises();
    expect(result.current).toBeNull();
  });

  test("handles multiple entity types simultaneously", async () => {
    const items = [
      makeItem("feature", "feat-1", "ready-to-review"),
      makeItem("task", "task-2", "plan-question"),
    ];
    const wrapper = makeWrapper(items);
    const { result: r1 } = renderHook(
      () => useAttentionType("feature", "feat-1"),
      { wrapper },
    );
    const { result: r2 } = renderHook(
      () => useAttentionType("task", "task-2"),
      { wrapper },
    );
    await flushPromises();
    expect(r1.current).toBe("ready-to-review");
    expect(r2.current).toBe("plan-question");
  });

  test("does not fetch when visibleWorkspaceSlugs is empty", async () => {
    const wrapper = makeWrapper([], []);
    renderHook(() => useAttentionType("feature", "feat-1"), { wrapper });
    await flushPromises();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Timer-based tests — use fake timers per-test
  // -------------------------------------------------------------------------

  test("interval poll re-fetches every 30 seconds", async () => {
    vi.useFakeTimers();
    const wrapper = makeWrapper([]);
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });

    renderHook(() => useAttentionType("feature", "x"), { wrapper });

    // Initial fetch fires synchronously via useEffect; flush its promise
    await act(async () => { await Promise.resolve(); });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Advance 30s → second fetch
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Advance another 30s → third fetch
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test("burst of events collapses into one re-fetch via debounce", async () => {
    vi.useFakeTimers();
    const items = [makeItem("task", "task-3", "awaiting-reply")];
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ items }),
    });
    const wrapper = makeWrapper(items);
    renderHook(() => useAttentionType("task", "task-3"), { wrapper });

    // Initial fetch
    await act(async () => { await Promise.resolve(); });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Three events in rapid succession (within 2s debounce)
    act(() => {
      wsChannelA._fire("workspace-task-title-update");
      wsChannelA._fire("workspace-task-title-update");
      wsChannelA._fire("workspace-task-title-update");
    });

    // Debounce not yet fired — still 1 fetch
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Advance past the 2s debounce
    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
    });

    // Exactly ONE additional fetch, not three
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("WORKSPACE_TASK_TITLE_UPDATE triggers a debounced refresh", async () => {
    vi.useFakeTimers();
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    const wrapper = makeWrapper([]);
    renderHook(() => useAttentionType("task", "task-4"), { wrapper });

    await act(async () => { await Promise.resolve(); });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    act(() => { wsChannelA._fire("workspace-task-title-update"); });

    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("per-entity WORKFLOW_STATUS_UPDATE triggers a debounced refresh", async () => {
    vi.useFakeTimers();
    const items = [makeItem("task", "task-5", "halted")];
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ items }),
    });
    const wrapper = makeWrapper(items);
    renderHook(() => useAttentionType("task", "task-5"), { wrapper });

    await act(async () => { await Promise.resolve(); });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    act(() => { entityChannel._fire("workflow-status-update"); });

    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("per-entity NEW_MESSAGE triggers a debounced refresh", async () => {
    vi.useFakeTimers();
    const items = [makeItem("feature", "feat-6", "plan-question")];
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ items }),
    });
    const wrapper = makeWrapper(items);
    renderHook(() => useAttentionType("feature", "feat-6"), { wrapper });

    await act(async () => { await Promise.resolve(); });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    act(() => { entityChannel._fire("new-message"); });

    await act(async () => {
      vi.advanceTimersByTime(2100);
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test("gracefully handles fetch failure — map retains last successful state", async () => {
    const items = [makeItem("feature", "feat-7", "ready-to-review")];
    (global.fetch as Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items }) })
      .mockResolvedValueOnce({ ok: false });

    vi.useFakeTimers();
    const wrapper = function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <AttentionMapProvider githubLogin="my-org" visibleWorkspaceSlugs={["ws-alpha"]}>
          {children}
        </AttentionMapProvider>
      );
    };

    const { result } = renderHook(
      () => useAttentionType("feature", "feat-7"),
      { wrapper },
    );

    // Initial fetch succeeds
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBe("ready-to-review");

    // Trigger the 30s interval → second fetch fails
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    // Map still reflects the successful fetch — no crash, no reset
    expect(result.current).toBe("ready-to-review");
  });

  test("graceful degradation when Pusher is unconfigured — badge reflects polled state", async () => {
    vi.mocked(usePusherChannel).mockReturnValue(null);

    const items = [makeItem("task", "task-8", "halted")];
    (global.fetch as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ items }),
    });

    const wrapper = function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <AttentionMapProvider githubLogin="my-org" visibleWorkspaceSlugs={["ws-alpha"]}>
          {children}
        </AttentionMapProvider>
      );
    };

    const { result } = renderHook(() => useAttentionType("task", "task-8"), {
      wrapper,
    });

    await flushPromises();
    // No crash; badge reflects the polled state
    expect(result.current).toBe("halted");
  });
});
