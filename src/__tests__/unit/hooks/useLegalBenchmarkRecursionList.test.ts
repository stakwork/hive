import { renderHook, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useLegalBenchmarkRecursionList } from "@/hooks/useLegalBenchmarkRecursionList";

// ─── Mocks ────────────────────────────────────────────────────────────────────

global.fetch = vi.fn();

const MOCK_API_DATA = [
  { ref_id: "ref-1", id: "antitrust/task-1", name: "Antitrust Task 1" },
  { ref_id: "ref-2", id: "contracts/task-2", name: "Contracts Task 2" },
];

function mockFetchSuccess(data = MOCK_API_DATA) {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data }),
  } as Response);
}

function mockFetchError(status = 500, error = "Internal Server Error") {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error }),
  } as Response);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useLegalBenchmarkRecursionList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and maps EvalSet entries to RecursionEntry shape", async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useLegalBenchmarkRecursionList());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0]).toMatchObject({
      refId: "ref-1",
      id: "antitrust/task-1",
      name: "Antitrust Task 1",
    });
    expect(result.current.entries[1]).toMatchObject({
      refId: "ref-2",
      id: "contracts/task-2",
      name: "Contracts Task 2",
    });
    expect(result.current.error).toBeNull();
  });

  it("maps reason field from API response when present", async () => {
    const dataWithReason = [
      { ref_id: "ref-1", id: "tax/task-1", name: "Tax Task 1", reason: "active" },
      { ref_id: "ref-2", id: "contracts/task-2", name: "Contracts Task 2", reason: "wasEnabled" },
      { ref_id: "ref-3", id: "antitrust/task-3", name: "Antitrust Task 3", reason: "multipleRuns" },
    ];
    mockFetchSuccess(dataWithReason);

    const { result } = renderHook(() => useLegalBenchmarkRecursionList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.entries[0].reason).toBe("active");
    expect(result.current.entries[1].reason).toBe("wasEnabled");
    expect(result.current.entries[2].reason).toBe("multipleRuns");
  });

  it("maps dateAddedToGraph from the API response, defaulting to null", async () => {
    const addedAt = "2025-08-24T01:46:40.000Z";
    const dataWithTimestamps = [
      { ref_id: "ref-1", id: "tax/task-1", name: "Tax Task 1", dateAddedToGraph: addedAt },
      { ref_id: "ref-2", id: "contracts/task-2", name: "Contracts Task 2" },
    ];
    mockFetchSuccess(dataWithTimestamps);

    const { result } = renderHook(() => useLegalBenchmarkRecursionList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.entries[0].dateAddedToGraph).toBe(addedAt);
    expect(result.current.entries[1].dateAddedToGraph).toBeNull();
  });

  it("sets reason to undefined when not present in API response", async () => {
    // MOCK_API_DATA does not have a reason field
    mockFetchSuccess(MOCK_API_DATA);

    const { result } = renderHook(() => useLegalBenchmarkRecursionList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // reason should be undefined (not present), not null or an empty string
    expect(result.current.entries[0].reason).toBeUndefined();
  });

  it("calls the correct endpoint URL", async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useLegalBenchmarkRecursionList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      "/api/workspaces/openlaw/legal/benchmarks/recursion",
    );
  });

  it("handles an empty data array", async () => {
    mockFetchSuccess([]);

    const { result } = renderHook(() => useLegalBenchmarkRecursionList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.entries).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it("sets error state on non-2xx response", async () => {
    mockFetchError(500, "Something went wrong");

    const { result } = renderHook(() => useLegalBenchmarkRecursionList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Something went wrong");
    expect(result.current.entries).toHaveLength(0);
  });

  it("sets error state on network failure", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useLegalBenchmarkRecursionList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Network error");
  });

  it("refetch() re-fetches immediately and updates entries", async () => {
    mockFetchSuccess([MOCK_API_DATA[0]]);

    const { result } = renderHook(() => useLegalBenchmarkRecursionList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.entries).toHaveLength(1);

    mockFetchSuccess(MOCK_API_DATA);
    await act(async () => { await result.current.refetch(); });

    expect(result.current.entries).toHaveLength(2);
  });

  it("clears error after a successful refetch", async () => {
    mockFetchError(500, "Oops");

    const { result } = renderHook(() => useLegalBenchmarkRecursionList());
    await waitFor(() => expect(result.current.error).toBe("Oops"));

    mockFetchSuccess();
    await act(async () => { await result.current.refetch(); });

    expect(result.current.error).toBeNull();
    expect(result.current.entries).toHaveLength(2);
  });

  // Polling test — uses fake timers in isolation
  it("polls every 30 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetchSuccess();

    try {
      const { result } = renderHook(() => useLegalBenchmarkRecursionList());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      // On mount the hook fires two fetches: one to /recursion (enrollment list)
      // and one to /recursion/summary (one-time summary fetch). Both resolve
      // before isLoading flips to false.
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);

      await act(async () => { vi.advanceTimersByTime(30_000); });
      // Only the /recursion polling interval fires — summary is one-time only.
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(3);

      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("summary fetch goes to /recursion/summary endpoint, not /recursion", async () => {
    mockFetchSuccess();

    const { result } = renderHook(() => useLegalBenchmarkRecursionList());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const calls = vi.mocked(global.fetch).mock.calls.map((c) => c[0] as string);
    expect(calls).toContain("/api/workspaces/openlaw/legal/benchmarks/recursion");
    expect(calls).toContain("/api/workspaces/openlaw/legal/benchmarks/recursion/summary");
  });
});
