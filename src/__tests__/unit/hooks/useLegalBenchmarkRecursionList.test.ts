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
    expect(result.current.entries[0]).toEqual({
      refId: "ref-1",
      id: "antitrust/task-1",
      name: "Antitrust Task 1",
    });
    expect(result.current.entries[1]).toEqual({
      refId: "ref-2",
      id: "contracts/task-2",
      name: "Contracts Task 2",
    });
    expect(result.current.error).toBeNull();
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
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);

      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(2);

      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
