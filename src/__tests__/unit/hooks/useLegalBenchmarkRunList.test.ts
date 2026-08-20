import { renderHook, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useLegalBenchmarkRunList } from "@/hooks/useLegalBenchmarkRunList";

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: { slug: "test-workspace" } }),
}));

const mockChannelBind = vi.fn();
const mockChannelUnbind = vi.fn();
const mockChannel = { bind: mockChannelBind, unbind: mockChannelUnbind };
let usePusherChannelArg: string | null = null;

vi.mock("@/hooks/usePusherChannel", () => ({
  usePusherChannel: (name: string | null) => {
    usePusherChannelArg = name;
    return mockChannel;
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

global.fetch = vi.fn();

const makeRow = (overrides: Partial<{
  id: string;
  status: string;
  projectId: number | null;
  result: string | null;
  createdAt: string;
}> = {}) => ({
  id: "runner-abc",
  workspaceId: "ws-cuid-123",
  status: "COMPLETED",
  projectId: 42,
  result: JSON.stringify({
    taskSlug: "antitrust/task-1",
    taskTitle: "Analyze Antitrust Strategy",
    n_passed: 72,
    n_total: 74,
    all_pass: true,
    pass_rate: 0.97,
    judge_model: "gpt-4",
  }),
  createdAt: new Date("2025-01-01T10:00:00Z").toISOString(),
  updatedAt: new Date("2025-01-01T10:05:00Z").toISOString(),
  ...overrides,
});

/**
 * The hook now issues one fetch per pipeline. Manual rows go to the RUNNER
 * request; analysis/recursion requests get their own lists (empty by default)
 * so single-pipeline tests keep their exact pre-split behaviour.
 */
function mockFetchOk(
  runs: ReturnType<typeof makeRow>[],
  total?: number,
  extra: { evalRuns?: ReturnType<typeof makeRow>[]; recursionRuns?: ReturnType<typeof makeRow>[]; evalOk?: boolean } = {},
) {
  vi.mocked(global.fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("type=LEGAL_BENCHMARK_EVAL")) {
      return {
        ok: extra.evalOk ?? true,
        json: async () => ({ runs: extra.evalRuns ?? [] }),
      } as Response;
    }
    if (url.includes("type=LEGAL_BENCHMARK_RECURSION")) {
      return {
        ok: true,
        json: async () => ({ runs: extra.recursionRuns ?? [] }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({ runs, total: total ?? runs.length }),
    } as Response;
  });
}

function mockFetchFail() {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  usePusherChannelArg = null;
});

afterEach(() => {
  // Restore real timers if a test switched to fake ones.
  vi.useRealTimers();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useLegalBenchmarkRunList", () => {
  it("fetches using workspace.id (cuid) — NOT slug — as workspaceId query param", async () => {
    mockFetchOk([makeRow()]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain("workspaceId=ws-cuid-123");
    expect(url).not.toContain("workspaceId=openlaw");
  });

  it("includes type=LEGAL_BENCHMARK_RUNNER and limit=100 in query params", async () => {
    mockFetchOk([makeRow()]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain("type=LEGAL_BENCHMARK_RUNNER");
    expect(url).toContain("limit=100");
    expect(url).toContain("includeResult=true");
  });

  it("maps run rows to BenchmarkRunListRow with parsed taskTitle and taskSlug", async () => {
    mockFetchOk([makeRow()]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.runs).toHaveLength(1);
    const row = result.current.runs[0];
    expect(row.id).toBe("runner-abc");
    expect(row.taskTitle).toBe("Analyze Antitrust Strategy");
    expect(row.taskSlug).toBe("antitrust/task-1");
    expect(row.status).toBe("COMPLETED");
    expect(row.projectId).toBe(42);
  });

  it("mapper carries flat score fields: n_passed, n_total, all_pass", async () => {
    mockFetchOk([makeRow()]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = result.current.runs[0];
    expect(row.n_passed).toBe(72);
    expect(row.n_total).toBe(74);
    expect(row.all_pass).toBe(true);
  });

  it("score fields are undefined for rows without score data (pre-collapse history)", async () => {
    mockFetchOk([
      makeRow({
        result: JSON.stringify({ taskSlug: "antitrust/task-1", taskTitle: "Old Task" }),
      }),
    ]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = result.current.runs[0];
    expect(row.n_passed).toBeUndefined();
    expect(row.n_total).toBeUndefined();
    expect(row.all_pass).toBeUndefined();
  });

  it("score field all_pass=false is preserved (not conflated with undefined)", async () => {
    mockFetchOk([
      makeRow({
        result: JSON.stringify({
          taskSlug: "antitrust/task-1",
          taskTitle: "Failing Task",
          n_passed: 10,
          n_total: 20,
          all_pass: false,
        }),
      }),
    ]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = result.current.runs[0];
    expect(row.all_pass).toBe(false);
    expect(typeof row.all_pass).toBe("boolean");
  });

  it("exposes total from API response", async () => {
    mockFetchOk([makeRow()], 150);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.total).toBe(150);
  });

  it("falls back to runs.length when total is absent from response", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ runs: [makeRow()] }),
    } as Response);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.total).toBe(1);
  });

  it("sets error state when fetch fails", async () => {
    mockFetchFail();

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.runs).toHaveLength(0);
  });

  it("does NOT poll when all runs are COMPLETED", async () => {
    vi.useFakeTimers();
    mockFetchOk([makeRow({ status: "COMPLETED" })]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));

    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.isLoading).toBe(false);
    const callsAfterInit = vi.mocked(global.fetch).mock.calls.length;

    await act(async () => { vi.advanceTimersByTime(30_000); });
    await act(async () => { await Promise.resolve(); });

    // No extra polls
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(callsAfterInit);
  });

  it("polls every 15 s while a run is IN_PROGRESS", async () => {
    vi.useFakeTimers();
    mockFetchOk([makeRow({ status: "IN_PROGRESS" })]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));

    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.isLoading).toBe(false);
    const callsAfterInit = vi.mocked(global.fetch).mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(callsAfterInit);
  });

  it("polls every 15 s while a run is PENDING", async () => {
    vi.useFakeTimers();
    mockFetchOk([makeRow({ status: "PENDING" })]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));

    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.isLoading).toBe(false);
    const callsAfterInit = vi.mocked(global.fetch).mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(callsAfterInit);
  });

  it("continues polling while a row is expanded when active runs remain", async () => {
    vi.useFakeTimers();
    mockFetchOk([makeRow({ status: "IN_PROGRESS" })]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));

    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.isLoading).toBe(false);

    // Expand a row — polling must continue since run is still active
    act(() => { result.current.setExpandedId("runner-abc"); });

    const callsAfterExpand = vi.mocked(global.fetch).mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    // Additional fetches happened even while expanded
    expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(callsAfterExpand);
  });

  it("score updates in place when a run completes while its row is expanded", async () => {
    vi.useFakeTimers();

    // Initially IN_PROGRESS, no score
    mockFetchOk([makeRow({ status: "IN_PROGRESS", result: JSON.stringify({ taskSlug: "antitrust/task-1", taskTitle: "Test" }) })]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));

    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.runs[0].all_pass).toBeUndefined();

    // Expand the row
    act(() => { result.current.setExpandedId("runner-abc"); });

    // Run completes with a score while row is expanded
    mockFetchOk([makeRow({ status: "COMPLETED" })]);

    await act(async () => {
      vi.advanceTimersByTime(15_000);
      await Promise.resolve();
    });

    // Score should now be present
    expect(result.current.runs[0].n_passed).toBe(72);
    expect(result.current.runs[0].all_pass).toBe(true);
  });

  it("resumes (refetches immediately) when setExpandedId returns to null", async () => {
    mockFetchOk([makeRow({ status: "IN_PROGRESS" })]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => { result.current.setExpandedId("runner-abc"); });
    const callsAfterExpand = vi.mocked(global.fetch).mock.calls.length;

    // Collapse → immediate refetch
    await act(async () => { result.current.setExpandedId(null); });
    await waitFor(() =>
      expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(callsAfterExpand),
    );
  });

  it("clears interval on unmount", async () => {
    vi.useFakeTimers();
    mockFetchOk([makeRow({ status: "IN_PROGRESS" })]);

    const { result, unmount } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.isLoading).toBe(false);

    const spyClear = vi.spyOn(globalThis, "clearInterval");
    unmount();
    expect(spyClear).toHaveBeenCalled();
  });

  it("does nothing when workspaceId is undefined", () => {
    const { result } = renderHook(() => useLegalBenchmarkRunList(undefined));
    expect(result.current.runs).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  // ─── judgeNotes tests ─────────────────────────────────────────────────────

  it("judgeNotes is populated with judge_model for COMPLETED rows", async () => {
    mockFetchOk([makeRow()]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = result.current.runs[0];
    expect(row.judgeNotes).toBe("72/74 criteria passed. Judge: gpt-4");
  });

  it("judgeNotes omits Judge suffix when judge_model is absent", async () => {
    mockFetchOk([
      makeRow({
        result: JSON.stringify({
          taskSlug: "antitrust/task-1",
          taskTitle: "Analyze Antitrust Strategy",
          n_passed: 72,
          n_total: 74,
          all_pass: true,
        }),
      }),
    ]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = result.current.runs[0];
    expect(row.judgeNotes).toBe("72/74 criteria passed");
  });

  it("judgeNotes is undefined for in-progress rows with no score fields", async () => {
    mockFetchOk([
      makeRow({
        status: "IN_PROGRESS",
        result: JSON.stringify({ taskSlug: "antitrust/task-1", taskTitle: "Test" }),
      }),
    ]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = result.current.runs[0];
    expect(row.judgeNotes).toBeUndefined();
  });

  // ─── Pusher subscription tests ────────────────────────────────────────────

  it("calls usePusherChannel with workspace-test-workspace when slug is available", async () => {
    mockFetchOk([makeRow()]);

    renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(usePusherChannelArg).toBe("workspace-test-workspace"));
  });

  it("binds STAKWORK_RUN_UPDATE event on mount", async () => {
    mockFetchOk([makeRow()]);

    renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(mockChannelBind).toHaveBeenCalledWith(
      "stakwork-run-update",
      expect.any(Function),
    ));
  });

  it("calls fetchRuns when STAKWORK_RUN_UPDATE fires with a matching runId", async () => {
    mockFetchOk([makeRow()]);

    renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(mockChannelBind).toHaveBeenCalled());

    const handler = mockChannelBind.mock.calls[0][1] as (data: { runId?: string }) => void;
    const fetchCallsBefore = vi.mocked(global.fetch).mock.calls.length;

    mockFetchOk([makeRow()]);
    await act(async () => {
      handler({ runId: "runner-abc" });
      await Promise.resolve();
    });

    expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(fetchCallsBefore);
  });

  it("calls fetchRuns when STAKWORK_RUN_UPDATE fires with an UNKNOWN runId (relaxed handler)", async () => {
    // The handler now refetches regardless of whether the run id is already in the
    // loaded list — so a header strip that hasn't yet seen a brand-new run still updates.
    mockFetchOk([makeRow()]);

    renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(mockChannelBind).toHaveBeenCalled());

    const handler = mockChannelBind.mock.calls[0][1] as (data: { runId?: string }) => void;
    const fetchCallsBefore = vi.mocked(global.fetch).mock.calls.length;

    mockFetchOk([makeRow()]);
    await act(async () => {
      handler({ runId: "runner-unknown-brand-new" });
      await Promise.resolve();
    });

    // Must have triggered a refetch even though the run was not in the loaded list
    expect(vi.mocked(global.fetch).mock.calls.length).toBeGreaterThan(fetchCallsBefore);
  });

  it("isFetchingRef burst-guard prevents overlapping refetches from rapid Pusher events", async () => {
    mockFetchOk([makeRow()]);

    renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(mockChannelBind).toHaveBeenCalled());

    const handler = mockChannelBind.mock.calls[0][1] as (data: { runId?: string }) => void;
    const fetchCallsBefore = vi.mocked(global.fetch).mock.calls.length;

    // Mock fetch to never resolve so isFetchingRef stays true
    vi.mocked(global.fetch).mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      // Fire three rapid events — only the first should trigger a fetch
      handler({ runId: "runner-abc" });
      handler({ runId: "runner-abc" });
      handler({ runId: "runner-abc" });
      await Promise.resolve();
    });

    // Only one additional fetchRuns (= 3 pipeline requests) despite three rapid events
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(fetchCallsBefore + 3);
  });

  it("unbinds STAKWORK_RUN_UPDATE event handler on unmount", async () => {
    mockFetchOk([makeRow()]);

    const { unmount } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(mockChannelBind).toHaveBeenCalled());

    const handler = mockChannelBind.mock.calls[0][1];
    unmount();

    expect(mockChannelUnbind).toHaveBeenCalledWith("stakwork-run-update", handler);
  });

  // ─── requestedModel / requestedJudgeModel ─────────────────────────────────

  it("requestedModel and requestedJudgeModel are mapped from parsed result", async () => {
    mockFetchOk([
      makeRow({
        result: JSON.stringify({
          taskSlug: "antitrust/task-1",
          taskTitle: "Analyze Antitrust Strategy",
          n_passed: 5,
          n_total: 5,
          all_pass: true,
          judge_model: "claude-sonnet-4-6-echoed",
          requestedModel: "claude-sonnet-5",
          requestedJudgeModel: "claude-sonnet-4-6",
        }),
      }),
    ]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = result.current.runs[0];
    expect(row.requestedModel).toBe("claude-sonnet-5");
    expect(row.requestedJudgeModel).toBe("claude-sonnet-4-6");
  });

  it("requestedModel and requestedJudgeModel are undefined when absent (legacy runs)", async () => {
    mockFetchOk([
      makeRow({
        result: JSON.stringify({
          taskSlug: "antitrust/task-1",
          taskTitle: "Analyze Antitrust Strategy",
          n_passed: 72,
          n_total: 74,
          judge_model: "gpt-4",
        }),
      }),
    ]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = result.current.runs[0];
    expect(row.requestedModel).toBeUndefined();
    expect(row.requestedJudgeModel).toBeUndefined();
  });

  it("judgeNotes uses requestedJudgeModel when present (takes precedence over judge_model)", async () => {
    mockFetchOk([
      makeRow({
        result: JSON.stringify({
          taskSlug: "antitrust/task-1",
          taskTitle: "Analyze Antitrust Strategy",
          n_passed: 5,
          n_total: 5,
          all_pass: true,
          judge_model: "claude-echoed-different",
          requestedJudgeModel: "claude-sonnet-4-6",
        }),
      }),
    ]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = result.current.runs[0];
    // Must show requestedJudgeModel, not the runner-echoed judge_model
    expect(row.judgeNotes).toBe("5/5 criteria passed. Judge: claude-sonnet-4-6");
    expect(row.judgeNotes).not.toContain("claude-echoed-different");
  });

  it("judgeNotes falls back to judge_model when requestedJudgeModel is absent (legacy runs)", async () => {
    // makeRow() default already has judge_model: "gpt-4" and no requestedJudgeModel
    mockFetchOk([makeRow()]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = result.current.runs[0];
    expect(row.judgeNotes).toBe("72/74 criteria passed. Judge: gpt-4");
  });

  it("judgeNotes shows no Judge suffix when both requestedJudgeModel and judge_model are absent", async () => {
    mockFetchOk([
      makeRow({
        result: JSON.stringify({
          taskSlug: "antitrust/task-1",
          taskTitle: "Analyze Antitrust Strategy",
          n_passed: 5,
          n_total: 5,
          all_pass: true,
          requestedModel: "claude-sonnet-5",
          // no requestedJudgeModel, no judge_model
        }),
      }),
    ]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const row = result.current.runs[0];
    expect(row.judgeNotes).toBe("5/5 criteria passed");
    expect(row.judgeNotes).not.toContain("Judge:");
  });
});

// ─── Multi-pipeline rows ─────────────────────────────────────────────────────

describe("useLegalBenchmarkRunList — analysis/recursion pipelines", () => {
  it("fetches all three run types", async () => {
    mockFetchOk([makeRow()]);
    renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(vi.mocked(global.fetch).mock.calls.length).toBe(3));

    const urls = vi.mocked(global.fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("type=LEGAL_BENCHMARK_RUNNER"))).toBe(true);
    expect(urls.some((u) => u.includes("type=LEGAL_BENCHMARK_EVAL"))).toBe(true);
    expect(urls.some((u) => u.includes("type=LEGAL_BENCHMARK_RECURSION"))).toBe(true);
  });

  it("tags rows by pipeline and merges newest-first", async () => {
    mockFetchOk([makeRow({ id: "manual-1", createdAt: "2025-01-01T10:00:00.000Z" })], undefined, {
      evalRuns: [
        makeRow({
          id: "eval-1",
          createdAt: "2025-01-01T12:00:00.000Z",
          result: JSON.stringify({ taskSlug: "antitrust/task-1", sourceRunId: "manual-1" }),
        }),
      ],
      recursionRuns: [
        makeRow({
          id: "rec-1",
          createdAt: "2025-01-01T11:00:00.000Z",
          result: JSON.stringify({ taskSlug: "antitrust/task-1", recursionId: "r-1" }),
        }),
      ],
    });

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.runs).toHaveLength(3));

    expect(result.current.runs.map((r) => r.id)).toEqual(["eval-1", "rec-1", "manual-1"]);
    // Both cron pipelines tag as "recursion" — analysis is an internal stage
    // of the loop, not an operator-facing category.
    expect(result.current.runs.map((r) => r.runType)).toEqual(["recursion", "recursion", "manual"]);
    // Secondary rows carry slug but no title (derived at render time) and no score
    const evalRow = result.current.runs[0];
    expect(evalRow.taskSlug).toBe("antitrust/task-1");
    expect(evalRow.taskTitle).toBe("");
    expect(evalRow.n_passed).toBeUndefined();
  });

  it("degrades to manual-only when a secondary fetch fails", async () => {
    mockFetchOk([makeRow({ id: "manual-1" })], undefined, { evalOk: false });

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.runs).toHaveLength(1));

    expect(result.current.runs[0].runType).toBe("manual");
    expect(result.current.error).toBeNull();
  });

  it("total still reflects the manual pipeline only", async () => {
    mockFetchOk([makeRow()], 42, {
      recursionRuns: [makeRow({ id: "rec-1", result: JSON.stringify({ taskSlug: "x" }) })],
    });
    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));
    await waitFor(() => expect(result.current.total).toBe(42));
  });
});
