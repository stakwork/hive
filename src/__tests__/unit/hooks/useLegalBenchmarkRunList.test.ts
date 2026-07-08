import { renderHook, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useLegalBenchmarkRunList } from "@/hooks/useLegalBenchmarkRunList";

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
    siblingRunId: "scorer-abc",
  }),
  createdAt: new Date("2025-01-01T10:00:00Z").toISOString(),
  updatedAt: new Date("2025-01-01T10:05:00Z").toISOString(),
  ...overrides,
});

function mockFetchOk(runs: ReturnType<typeof makeRow>[], total?: number) {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ runs, total: total ?? runs.length }),
  } as Response);
}

function mockFetchFail() {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: false,
    json: async () => ({}),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
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

  it("polls every 15 s while a run is IN_PROGRESS (dual equality guard, not always-truthy form)", async () => {
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

  it("polls every 15 s while a run is PENDING (dual equality guard)", async () => {
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

  it("pauses polling when setExpandedId is called with a non-null id", async () => {
    vi.useFakeTimers();
    mockFetchOk([makeRow({ status: "IN_PROGRESS" })]);

    const { result } = renderHook(() => useLegalBenchmarkRunList("ws-cuid-123"));

    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    const callsAfterInit = vi.mocked(global.fetch).mock.calls.length;

    // Expand a row → polling must pause
    act(() => { result.current.setExpandedId("runner-abc"); });

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    // No additional fetches while row is expanded
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(callsAfterInit);
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
});
