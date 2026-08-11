import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mock the store module so tests control fetch / visibility
// ---------------------------------------------------------------------------

const mockFetchPoolStatusDeduped = vi.fn();
const mockRegisterResumeCallback = vi.fn();
const mockIsDocumentVisible = vi.fn(() => true);

vi.mock("@/hooks/poolStatusStore", () => ({
  fetchPoolStatusDeduped: (...args: unknown[]) =>
    mockFetchPoolStatusDeduped(...args),
  registerResumeCallback: (...args: unknown[]) =>
    mockRegisterResumeCallback(...args),
  isDocumentVisible: () => mockIsDocumentVisible(),
}));

import { usePoolStatus } from "@/hooks/usePoolStatus";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatus(overrides = {}) {
  return {
    availableVms: 2,
    usedVms: 1,
    totalVms: 3,
    queuedCount: 0,
    ...overrides,
  };
}

function makeOkFetch(status = makeStatus()) {
  return Promise.resolve(status);
}

// Default: registerResumeCallback returns an unregister no-op and captures cb
let capturedResumeCallbacks: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  capturedResumeCallbacks = [];
  mockFetchPoolStatusDeduped.mockReset();
  mockIsDocumentVisible.mockReset();
  mockIsDocumentVisible.mockReturnValue(true);
  mockRegisterResumeCallback.mockReset();
  mockRegisterResumeCallback.mockImplementation((cb: () => void) => {
    capturedResumeCallbacks.push(cb);
    return () => {
      capturedResumeCallbacks = capturedResumeCallbacks.filter((c) => c !== cb);
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Test 5: fresh mount reports loading:true then loading:false
// ---------------------------------------------------------------------------

describe("initial mount behavior", () => {
  it("reports loading:true immediately, then loading:false after fetch resolves", async () => {
    mockFetchPoolStatusDeduped.mockReturnValue(makeOkFetch());

    const { result } = renderHook(() =>
      usePoolStatus("my-slug", true)
    );

    // loading starts true
    expect(result.current.loading).toBe(true);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.poolStatus).toEqual(makeStatus());
  });

  it("sets error and loading:false when fetch throws", async () => {
    mockFetchPoolStatusDeduped.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() =>
      usePoolStatus("my-slug", true)
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("Network error");
    expect(result.current.poolStatus).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test 7: empty/undefined slug issues no request
// ---------------------------------------------------------------------------

describe("slug gating", () => {
  it("issues no fetch and sets loading:false when slug is empty string", async () => {
    const { result } = renderHook(() =>
      usePoolStatus("", true)
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetchPoolStatusDeduped).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("issues no fetch and sets loading:false when slug is undefined", async () => {
    const { result } = renderHook(() =>
      usePoolStatus(undefined, true)
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetchPoolStatusDeduped).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test 6: interval-0 caller with isPoolActive:false performs no fetch
// ---------------------------------------------------------------------------

describe("isPoolActive gating", () => {
  it("issues no fetch when isPoolActive is false (interval=0)", async () => {
    const { result } = renderHook(() =>
      usePoolStatus("my-slug", false)
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetchPoolStatusDeduped).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it("does not start a poller or register a resume callback when isPoolActive is false", async () => {
    renderHook(() =>
      usePoolStatus("my-slug", false, { pollingInterval: 30000 })
    );

    await act(async () => {
      vi.advanceTimersByTime(60000);
      await Promise.resolve();
    });

    expect(mockFetchPoolStatusDeduped).not.toHaveBeenCalled();
    expect(mockRegisterResumeCallback).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 4: pollingInterval:0 — one fetch on mount, no timer, no resume callback
// ---------------------------------------------------------------------------

describe("pollingInterval:0 (CapacityPage / TaskChatPage callers)", () => {
  it("performs exactly one fetch on mount and never schedules a timer", async () => {
    mockFetchPoolStatusDeduped.mockReturnValue(makeOkFetch());

    renderHook(() => usePoolStatus("cap-slug", true)); // no pollingInterval

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetchPoolStatusDeduped).toHaveBeenCalledTimes(1);

    // Advance time — no extra calls
    await act(async () => {
      vi.advanceTimersByTime(120_000);
      await Promise.resolve();
    });

    expect(mockFetchPoolStatusDeduped).toHaveBeenCalledTimes(1);
  });

  it("never registers a resume callback", async () => {
    mockFetchPoolStatusDeduped.mockReturnValue(makeOkFetch());

    renderHook(() => usePoolStatus("cap-slug", true));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRegisterResumeCallback).not.toHaveBeenCalled();
  });

  it("refetch triggers a new fetch unconditionally", async () => {
    mockFetchPoolStatusDeduped.mockReturnValue(makeOkFetch());

    const { result } = renderHook(() => usePoolStatus("cap-slug", true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetchPoolStatusDeduped).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockFetchPoolStatusDeduped).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Test 3: initial fetch and refetch fire even while tab is hidden
// ---------------------------------------------------------------------------

describe("initial fetch and refetch are not visibility-gated", () => {
  it("performs initial fetch even when document is hidden", async () => {
    mockIsDocumentVisible.mockReturnValue(false); // tab is hidden
    mockFetchPoolStatusDeduped.mockReturnValue(makeOkFetch());

    renderHook(() => usePoolStatus("hidden-slug", true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The initial fetch must have fired despite the tab being hidden
    expect(mockFetchPoolStatusDeduped).toHaveBeenCalledTimes(1);
  });

  it("refetch fires even when document is hidden", async () => {
    mockIsDocumentVisible.mockReturnValue(false);
    mockFetchPoolStatusDeduped.mockReturnValue(makeOkFetch());

    const { result } = renderHook(() => usePoolStatus("hidden-slug", true));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockFetchPoolStatusDeduped).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Test 2: background poll is skipped when hidden; resumes on visible transition
// ---------------------------------------------------------------------------

describe("visibility-aware polling (pollingInterval > 0)", () => {
  it("registers a resume callback and starts a polling timer", async () => {
    mockFetchPoolStatusDeduped.mockReturnValue(makeOkFetch());
    mockIsDocumentVisible.mockReturnValue(true);

    renderHook(() =>
      usePoolStatus("poll-slug", true, { pollingInterval: 1000 })
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockRegisterResumeCallback).toHaveBeenCalledTimes(1);
  });

  it("skips the poll tick when document is hidden", async () => {
    mockFetchPoolStatusDeduped.mockReturnValue(makeOkFetch());
    // Initial fetch fires (visible doesn't matter for initial)
    // Polling ticks: hidden
    mockIsDocumentVisible.mockReturnValue(false);

    renderHook(() =>
      usePoolStatus("poll-slug", true, { pollingInterval: 1000 })
    );

    // Initial fetch (not gated)
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const afterInitial = mockFetchPoolStatusDeduped.mock.calls.length;

    // Advance past several polling intervals — all ticks should be skipped
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });

    // No extra fetches because tab was hidden
    expect(mockFetchPoolStatusDeduped.mock.calls.length).toBe(afterInitial);
  });

  it("fires an immediate refresh and reschedules on resume (visible transition)", async () => {
    mockFetchPoolStatusDeduped.mockReturnValue(makeOkFetch());
    mockIsDocumentVisible.mockReturnValue(false); // start hidden

    renderHook(() =>
      usePoolStatus("poll-slug", true, { pollingInterval: 1000 })
    );

    // Initial fetch
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const afterInitial = mockFetchPoolStatusDeduped.mock.calls.length;

    // Advance timers while hidden — tick fires but skips fetch, doesn't reschedule
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(mockFetchPoolStatusDeduped.mock.calls.length).toBe(afterInitial);

    // Simulate tab becoming visible — the resume callback fires
    mockIsDocumentVisible.mockReturnValue(true);
    await act(async () => {
      capturedResumeCallbacks.forEach((cb) => cb());
      await Promise.resolve();
      await Promise.resolve();
    });

    // Immediate refresh fired
    expect(mockFetchPoolStatusDeduped.mock.calls.length).toBe(
      afterInitial + 1
    );

    // New polling loop started — advance one interval
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockFetchPoolStatusDeduped.mock.calls.length).toBeGreaterThanOrEqual(
      afterInitial + 2
    );
  });

  it("unregisters the resume callback on unmount", async () => {
    const mockUnregister = vi.fn();
    mockRegisterResumeCallback.mockReturnValue(mockUnregister);
    mockFetchPoolStatusDeduped.mockReturnValue(makeOkFetch());

    const { unmount } = renderHook(() =>
      usePoolStatus("poll-slug", true, { pollingInterval: 1000 })
    );

    await act(async () => {
      await Promise.resolve();
    });

    unmount();

    expect(mockUnregister).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Test 5 (independence): fresh mount has its own loading:true regardless of
// another mount already fetching the same slug
// ---------------------------------------------------------------------------

describe("per-mount loading independence", () => {
  it("each new mount starts with loading:true independent of other mounts", async () => {
    // First mount fetches and resolves
    let resolveFirst!: (v: unknown) => void;
    const blocker = new Promise((res) => {
      resolveFirst = res;
    });
    const statusValue = makeStatus();
    mockFetchPoolStatusDeduped.mockReturnValue(
      blocker.then(() => statusValue)
    );

    const { result: r1 } = renderHook(() =>
      usePoolStatus("shared-slug", true)
    );

    // Both start as loading
    expect(r1.current.loading).toBe(true);

    const { result: r2 } = renderHook(() =>
      usePoolStatus("shared-slug", true)
    );

    expect(r2.current.loading).toBe(true);

    // Now resolve
    resolveFirst(undefined);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(r1.current.loading).toBe(false);
    expect(r2.current.loading).toBe(false);
    expect(r1.current.poolStatus).toEqual(statusValue);
    expect(r2.current.poolStatus).toEqual(statusValue);
  });
});
