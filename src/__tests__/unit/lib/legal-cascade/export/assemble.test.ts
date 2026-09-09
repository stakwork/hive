/**
 * assembleCascadeExport — the server-side snapshot behind the offline HTML
 * export. Covers:
 *   - live path: sessions → descendants (only where child_count > 0) →
 *     cursored turn pages until the version counter is satisfied → model
 *   - the snapshot is frozen (no live agents, no running strip)
 *   - concept peeks: READ ref_ids are prefetched with the export's own caps,
 *     results and skips land in the payload
 *   - USE_MOCKS path: fixtures in, no upstream or Jarvis calls
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CascadeAccess } from "@/lib/legal-cascade/server";
import type { CascadeSession, CascadeTurn } from "@/lib/legal-cascade/types";
import {
  buildMockCascadeSessions,
  MOCK_PLAN_CHILD_ID,
  MOCK_PLAN_SESSION_ID,
  MOCK_REPAIR_SESSION_ID,
} from "@/lib/legal-cascade/fixtures";

const mockFetchRunSessions = vi.hoisted(() => vi.fn());
const mockFetchSessionDetail = vi.hoisted(() => vi.fn());
const mockFetchSessionTurns = vi.hoisted(() => vi.fn());
const mockPrefetchNodePeeks = vi.hoisted(() => vi.fn());

vi.mock("@/lib/legal-cascade/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/legal-cascade/server")>(
    "@/lib/legal-cascade/server",
  );
  return {
    ...actual,
    fetchRunSessions: mockFetchRunSessions,
    fetchSessionDetail: mockFetchSessionDetail,
    fetchSessionTurns: mockFetchSessionTurns,
  };
});

vi.mock("@/lib/run-report/export/peek-prefetch", () => ({
  prefetchNodePeeks: mockPrefetchNodePeeks,
}));

import {
  assembleCascadeExport,
  collectPeekRefIds,
  CASCADE_EXPORT_MAX_PEEKS,
  CASCADE_EXPORT_PEEK_BUDGET_MS,
} from "@/lib/legal-cascade/export/assemble";

function access(overrides: Partial<CascadeAccess> = {}): CascadeAccess {
  return {
    userId: "user-1",
    slug: "openlaw",
    workspaceId: "ws-1",
    runId: "run-1",
    projectId: 147813394,
    baseUrl: "https://swarm.example:3355",
    apiKey: "secret",
    swarmName: "swarm-a",
    useMocks: false,
    ...overrides,
  };
}

function session(overrides: Partial<CascadeSession> & { id: string }): CascadeSession {
  return {
    parent_session_id: "",
    agent_name: "",
    source: "repo_agent",
    status: "success",
    turn_count: 0,
    last_turn_at: null,
    timestamp: "2025-08-17T16:43:20.000Z",
    model: null,
    repo: null,
    token_usage: null,
    child_count: 0,
    ...overrides,
  };
}

function turn(order: number, overrides: Partial<CascadeTurn> = {}): CascadeTurn {
  return {
    order,
    turn_id: `t-${order}`,
    turn_type: "reasoning",
    tool: null,
    tool_call_id: null,
    content: `turn ${order}`,
    timestamp: 1755449000000 + order * 1000,
    concepts: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrefetchNodePeeks.mockResolvedValue({ peeks: new Map(), skipped: [] });
});

describe("assembleCascadeExport (live)", () => {
  it("walks sessions, descendants and every turn page, then freezes the model", async () => {
    const top = session({
      id: "top-1",
      agent_name: "plan-agent-147813394",
      status: "running",
      turn_count: 3,
      child_count: 1,
    });
    const child = session({
      id: "top-1-sub-aaaaaaaa",
      parent_session_id: "top-1",
      status: "running",
      turn_count: 1,
    });
    mockFetchRunSessions.mockResolvedValue({ identifier: "147813394", sessions: [top] });
    mockFetchSessionDetail.mockResolvedValue({ session: top, descendants: [child] });

    // The top session's chain arrives in two pages: the first page stops
    // short of turn_count, so a second page is requested from the cursor.
    mockFetchSessionTurns.mockImplementation(async (_a, sessionId: string, after: number) => {
      if (sessionId === "top-1") {
        if (after === -1) {
          return {
            session_id: sessionId,
            status: "running",
            turn_count: 3,
            last_turn_at: null,
            turns: [turn(0, { turn_type: "user_input", content: "go" }), turn(1)],
          };
        }
        if (after === 1) {
          return {
            session_id: sessionId,
            status: "running",
            turn_count: 3,
            last_turn_at: null,
            turns: [turn(2, { turn_type: "response", content: "done" })],
          };
        }
        return { session_id: sessionId, status: "running", turn_count: 3, last_turn_at: null, turns: [] };
      }
      return {
        session_id: sessionId,
        status: "running",
        turn_count: 1,
        last_turn_at: null,
        turns: after === -1 ? [turn(0, { turn_type: "user_input", content: "sub" })] : [],
      };
    });

    const payload = await assembleCascadeExport(
      access(),
      () => new Date("2026-09-02T12:00:00.000Z"),
    );

    expect(mockFetchSessionDetail).toHaveBeenCalledTimes(1);
    // top-1: after=-1 then after=1 (cursor), stopping once turn_count is met.
    const topCalls = mockFetchSessionTurns.mock.calls.filter((c) => c[1] === "top-1");
    expect(topCalls.map((c) => c[2])).toEqual([-1, 1]);
    // The child needed one page only.
    const childCalls = mockFetchSessionTurns.mock.calls.filter((c) => c[1] === child.id);
    expect(childCalls.map((c) => c[2])).toEqual([-1]);

    expect(payload.model.summary.agents).toBe(1);
    expect(payload.model.summary.subAgents).toBe(1);
    // Frozen: nothing is live in a snapshot, though statuses stay as recorded.
    expect(payload.model.summary.running).toBe(false);
    expect(payload.model.agents.every((a) => a.live === false)).toBe(true);
    expect(payload.model.agents[0].session.status).toBe("running");

    expect(payload.meta).toEqual({
      runId: "run-1",
      identifier: "147813394",
      exportedAt: "2026-09-02T12:00:00.000Z",
      skippedPeeks: [],
    });
  });

  it("skips the detail fetch for sessions without children", async () => {
    const top = session({ id: "solo", agent_name: "x-147813394", turn_count: 0 });
    mockFetchRunSessions.mockResolvedValue({ identifier: "147813394", sessions: [top] });
    mockFetchSessionTurns.mockResolvedValue({
      session_id: "solo",
      status: "success",
      turn_count: 0,
      last_turn_at: null,
      turns: [],
    });

    await assembleCascadeExport(access());

    expect(mockFetchSessionDetail).not.toHaveBeenCalled();
  });

  it("prefetches a peek for every READ concept with the export's caps and records skips", async () => {
    const top = session({ id: "top-1", agent_name: "x-147813394", turn_count: 3 });
    mockFetchRunSessions.mockResolvedValue({ identifier: "147813394", sessions: [top] });
    mockFetchSessionTurns.mockResolvedValue({
      session_id: "top-1",
      status: "success",
      turn_count: 3,
      last_turn_at: null,
      turns: [
        turn(0, { turn_type: "user_input", content: "go" }),
        turn(1, {
          turn_type: "tool_result",
          tool: "graph_get",
          concepts: [
            { ref_id: "onto-1", id: null, name: "wfa-ontology" },
            { ref_id: "cc-1", id: null, name: "contract-clauses" },
          ],
        }),
        turn(2, { turn_type: "response", content: "done" }),
      ],
    });
    mockPrefetchNodePeeks.mockResolvedValue({
      peeks: new Map([["onto-1", { state: "done", payload: { name: "wfa-ontology" } }]]),
      skipped: ["cc-1"],
    });

    const payload = await assembleCascadeExport(access());

    expect(mockPrefetchNodePeeks).toHaveBeenCalledWith(
      expect.arrayContaining(["onto-1", "cc-1"]),
      { swarmName: "swarm-a", swarmApiKey: "secret" },
      { maxIds: CASCADE_EXPORT_MAX_PEEKS, budgetMs: CASCADE_EXPORT_PEEK_BUDGET_MS },
    );
    expect(payload.peeks).toEqual({
      "onto-1": { state: "done", payload: { name: "wfa-ontology" } },
    });
    expect(payload.meta.skippedPeeks).toEqual(["cc-1"]);
  });

  it("does not call Jarvis when the run read no concepts", async () => {
    const top = session({ id: "top-1", agent_name: "x-147813394", turn_count: 1 });
    mockFetchRunSessions.mockResolvedValue({ identifier: "147813394", sessions: [top] });
    mockFetchSessionTurns.mockResolvedValue({
      session_id: "top-1",
      status: "success",
      turn_count: 1,
      last_turn_at: null,
      turns: [turn(0, { turn_type: "user_input", content: "go" })],
    });

    await assembleCascadeExport(access());

    expect(mockPrefetchNodePeeks).not.toHaveBeenCalled();
  });
});

describe("assembleCascadeExport (USE_MOCKS)", () => {
  it("builds the fixture run without touching stakgraph or Jarvis", async () => {
    const payload = await assembleCascadeExport(access({ useMocks: true, baseUrl: "" }));

    expect(mockFetchRunSessions).not.toHaveBeenCalled();
    expect(mockFetchSessionTurns).not.toHaveBeenCalled();
    expect(mockPrefetchNodePeeks).not.toHaveBeenCalled();

    const ids = payload.model.agents.map((a) => a.session.id);
    expect(ids).toEqual(
      expect.arrayContaining([MOCK_PLAN_SESSION_ID, MOCK_REPAIR_SESSION_ID]),
    );
    expect(payload.model.summary.subAgents).toBe(1);
    // The child fork is spliced into the plan session's rows.
    const plan = payload.model.agents.find((a) => a.session.id === MOCK_PLAN_SESSION_ID)!;
    expect(plan.rows.some((r) => r.kind === "agent" && r.childSessionId === MOCK_PLAN_CHILD_ID)).toBe(true);
    expect(payload.meta.identifier).toBe("147813394");
    expect(payload.peeks).toEqual({});
  });
});

describe("collectPeekRefIds", () => {
  it("returns each READ concept's ref_id once and ignores display-parsed rows", async () => {
    const payload = await assembleCascadeExport(access({ useMocks: true, baseUrl: "" }));
    const ids = collectPeekRefIds(payload.model);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["onto-1", "cc-1"]));
    // The CREATED row (indemnification-scope) has no ref_id.
    expect(ids).not.toContain("indemnification-scope");
    expect(buildMockCascadeSessions("147813394").length).toBeGreaterThan(0);
  });
});
