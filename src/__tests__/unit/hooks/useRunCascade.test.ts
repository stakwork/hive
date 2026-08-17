import { renderHook, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useRunCascade } from "@/hooks/useRunCascade";
import {
  buildMockCascadeSessions,
  buildMockSessionDetail,
  buildMockSessionTurns,
  MOCK_PLAN_SESSION_ID,
  MOCK_PLAN_CHILD_ID,
  MOCK_REPAIR_SESSION_ID,
} from "@/lib/legal-cascade/fixtures";
import type { CascadeSession } from "@/lib/legal-cascade/types";

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: { id: "ws-cuid-123", slug: "openlaw" } }),
}));

const mockChannelBind = vi.fn();
const mockChannelUnbind = vi.fn();
const mockChannel = { bind: mockChannelBind, unbind: mockChannelUnbind };

vi.mock("@/hooks/usePusherChannel", () => ({
  usePusherChannel: () => mockChannel,
}));

// ─── Fetch router ─────────────────────────────────────────────────────────────

const IDENTIFIER = "147813394";
const RUN_ID = "run-cuid-1";

/** Mutable upstream state the fetch router serves from. */
let upstreamSessions: CascadeSession[] = [];
let upstreamStatusOverride: Partial<Record<string, CascadeSession["status"]>> = {};

function servedSessions(): CascadeSession[] {
  return upstreamSessions.map((s) =>
    upstreamStatusOverride[s.id] ? { ...s, status: upstreamStatusOverride[s.id]! } : s,
  );
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

const calls = { sessions: 0, session: 0, turns: [] as string[] };

function installFetchRouter() {
  vi.mocked(global.fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/cascade/sessions?")) {
      calls.sessions += 1;
      return jsonResponse({
        success: true,
        data: {
          identifier: IDENTIFIER,
          sessions: servedSessions().filter((s) => s.agent_name !== ""),
        },
      });
    }
    if (url.includes("/cascade/session?")) {
      calls.session += 1;
      const sessionId = new URL(url, "http://x").searchParams.get("sessionId")!;
      const detail = buildMockSessionDetail(IDENTIFIER, sessionId, true);
      if (!detail) return jsonResponse({ error: "not found" }, false);
      const { descendants = [], ...session } = detail;
      return jsonResponse({
        success: true,
        data: {
          session,
          descendants: descendants.map((d) =>
            upstreamStatusOverride[d.id] ? { ...d, status: upstreamStatusOverride[d.id]! } : d,
          ),
        },
      });
    }
    if (url.includes("/cascade/turns?")) {
      calls.turns.push(url);
      const params = new URL(url, "http://x").searchParams;
      const sessionId = params.get("sessionId")!;
      const after = parseInt(params.get("after") ?? "-1", 10);
      const page = buildMockSessionTurns(IDENTIFIER, sessionId, after);
      if (!page) return jsonResponse({ error: "not found" }, false);
      return jsonResponse({ success: true, data: page });
    }
    return jsonResponse({ error: "unexpected url " + url }, false);
  });
}

global.fetch = vi.fn();

const flush = () =>
  act(async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  });

beforeEach(() => {
  vi.clearAllMocks();
  calls.sessions = 0;
  calls.session = 0;
  calls.turns = [];
  upstreamSessions = buildMockCascadeSessions(IDENTIFIER);
  upstreamStatusOverride = {};
  installFetchRouter();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useRunCascade", () => {
  it("fetches the sessions list through the workspace-scoped proxy with the runId", async () => {
    const { result } = renderHook(() =>
      useRunCascade(RUN_ID, { enabled: false, runStatus: "COMPLETED" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain("/api/workspaces/openlaw/legal/benchmarks/cascade/sessions");
    expect(url).toContain(`runId=${RUN_ID}`);
    expect(result.current.sessions).toHaveLength(2);
  });

  it("does NOT fetch details or turns while disabled (pill-only mode)", async () => {
    const { result } = renderHook(() =>
      useRunCascade(RUN_ID, { enabled: false, runStatus: "COMPLETED" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(calls.session).toBe(0);
    expect(calls.turns).toHaveLength(0);
    expect(result.current.model).toBeNull();
  });

  it("runs the full protocol when enabled: details for parents with children, turns for every session, assembled model", async () => {
    const { result } = renderHook(() =>
      useRunCascade(RUN_ID, { enabled: true, runStatus: "COMPLETED" }),
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());

    // Only the plan session has child_count > 0.
    expect(calls.session).toBe(1);
    // Turns fetched for both top-level sessions and the discovered child.
    const turnSessionIds = calls.turns.map(
      (u) => new URL(u, "http://x").searchParams.get("sessionId")!,
    );
    expect(new Set(turnSessionIds)).toEqual(
      new Set([MOCK_PLAN_SESSION_ID, MOCK_REPAIR_SESSION_ID, MOCK_PLAN_CHILD_ID]),
    );

    const model = result.current.model!;
    expect(model.agents).toHaveLength(2);
    expect(model.summary.subAgents).toBe(1);
    expect(model.summary.concepts).toBe(3);
    expect(result.current.isLive).toBe(false);
  });

  it("first turns fetch uses after=-1; later cycles pass the max order seen and skip unchanged sessions", async () => {
    const { result } = renderHook(() =>
      useRunCascade(RUN_ID, { enabled: true, runStatus: "COMPLETED" }),
    );
    await waitFor(() => expect(result.current.model).not.toBeNull());

    const firstRepairCall = calls.turns.find((u) => u.includes(MOCK_REPAIR_SESSION_ID))!;
    expect(new URL(firstRepairCall, "http://x").searchParams.get("after")).toBe("-1");

    // Nothing changed — a refetch cycle must fetch NO turns at all.
    calls.turns = [];
    await act(async () => {
      await result.current.refetch();
    });
    expect(calls.turns).toHaveLength(0);

    // Bump one session's version counter — only that session is re-fetched,
    // from its cursor.
    upstreamSessions = upstreamSessions.map((s) =>
      s.id === MOCK_REPAIR_SESSION_ID ? { ...s, turn_count: s.turn_count + 1 } : s,
    );
    await act(async () => {
      await result.current.refetch();
    });
    expect(calls.turns).toHaveLength(1);
    const cursorCall = new URL(calls.turns[0], "http://x").searchParams;
    expect(cursorCall.get("sessionId")).toBe(MOCK_REPAIR_SESSION_ID);
    expect(cursorCall.get("after")).toBe("4"); // repair chain's last order
  });

  it("polls every 15 s while a session is running", async () => {
    vi.useFakeTimers();
    upstreamStatusOverride = { [MOCK_REPAIR_SESSION_ID]: "running" };

    renderHook(() => useRunCascade(RUN_ID, { enabled: true, runStatus: "COMPLETED" }));
    await flush();
    const callsAfterInit = calls.sessions;
    expect(callsAfterInit).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(calls.sessions).toBeGreaterThan(callsAfterInit);
  });

  it("keeps polling while the run's workflow is active even with no session running (new agents can appear)", async () => {
    vi.useFakeTimers();
    renderHook(() => useRunCascade(RUN_ID, { enabled: false, runStatus: "IN_PROGRESS" }));
    await flush();
    const callsAfterInit = calls.sessions;

    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    await flush();
    expect(calls.sessions).toBeGreaterThan(callsAfterInit);
  });

  it("stops polling when no session is running and the run is terminal", async () => {
    vi.useFakeTimers();
    renderHook(() => useRunCascade(RUN_ID, { enabled: true, runStatus: "COMPLETED" }));
    await flush();
    const callsAfterInit = calls.sessions;

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    await flush();
    expect(calls.sessions).toBe(callsAfterInit);
  });

  it("refetches on a Pusher STAKWORK_RUN_UPDATE for this run and ignores other runs", async () => {
    const { result } = renderHook(() =>
      useRunCascade(RUN_ID, { enabled: false, runStatus: "COMPLETED" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(mockChannelBind).toHaveBeenCalled());

    const handler = mockChannelBind.mock.calls.find(
      (c) => c[0] === "stakwork-run-update",
    )![1] as (data: { runId?: string }) => void;

    const before = calls.sessions;
    await act(async () => {
      handler({ runId: "some-other-run" });
    });
    await flush();
    expect(calls.sessions).toBe(before);

    await act(async () => {
      handler({ runId: RUN_ID });
    });
    await flush();
    expect(calls.sessions).toBeGreaterThan(before);
  });

  it("sets error on fetch failure and recovers on the next successful cycle", async () => {
    vi.mocked(global.fetch).mockResolvedValue(jsonResponse({}, false));
    const { result } = renderHook(() =>
      useRunCascade(RUN_ID, { enabled: false, runStatus: "COMPLETED" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();

    installFetchRouter();
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.sessions).toHaveLength(2);
  });

  it("unbinds the Pusher handler on unmount", async () => {
    const { unmount } = renderHook(() =>
      useRunCascade(RUN_ID, { enabled: false, runStatus: "COMPLETED" }),
    );
    await waitFor(() => expect(mockChannelBind).toHaveBeenCalled());
    const handler = mockChannelBind.mock.calls[0][1];
    unmount();
    expect(mockChannelUnbind).toHaveBeenCalledWith("stakwork-run-update", handler);
  });
});
