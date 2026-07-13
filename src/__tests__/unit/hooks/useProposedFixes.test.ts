import { renderHook, waitFor, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { useProposedFixes } from "@/hooks/useProposedFixes";
import type { ProposedFix } from "@/types/legal";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockWorkspace = {
  id: "workspace-123",
  slug: "openlaw",
};

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(() => ({ workspace: mockWorkspace })),
}));

global.fetch = vi.fn();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_FIX: ProposedFix = {
  ref_id: "fix-1",
  criterion_id: "crit-1",
  criterion_title: "Accuracy",
  prompt_name: "citation_v2",
  rerun_status: "improved",
  before_score: "50",
  after_score: "54",
  score_delta: "+4",
};

function mockFetchSuccess(fixes: ProposedFix[] = [MOCK_FIX]) {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ fixes }),
  } as Response);
}

function mockFetchError(status = 500, body: Record<string, unknown> = { error: "Internal error" }) {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => body,
  } as Response);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useProposedFixes", () => {
  const runId = "run-abc";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts in loading state and resolves with fixes on success", async () => {
    mockFetchSuccess([MOCK_FIX]);
    const { result } = renderHook(() => useProposedFixes(runId));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.fixes).toEqual([]);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.fixes).toHaveLength(1);
    expect(result.current.fixes[0].ref_id).toBe("fix-1");
    expect(result.current.error).toBeNull();
  });

  it("fetches from the correct URL", async () => {
    mockFetchSuccess([]);
    renderHook(() => useProposedFixes(runId));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    expect(global.fetch).toHaveBeenCalledWith(
      `/api/workspaces/openlaw/legal/benchmarks/proposed-fixes?runId=${encodeURIComponent(runId)}`,
    );
  });

  it("sets error state when the server returns a non-ok response", async () => {
    mockFetchError(500, { error: "Something went wrong" });
    const { result } = renderHook(() => useProposedFixes(runId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.fixes).toEqual([]);
    expect(result.current.error).toBe("Something went wrong");
  });

  it("sets a generic error when the JSON body lacks an error field", async () => {
    mockFetchError(403, {});
    const { result } = renderHook(() => useProposedFixes(runId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toMatch(/403/);
  });

  it("returns an empty fixes array when the endpoint returns { fixes: [] }", async () => {
    mockFetchSuccess([]);
    const { result } = renderHook(() => useProposedFixes(runId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.fixes).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("exposes a refetch function that re-fetches on demand", async () => {
    mockFetchSuccess([MOCK_FIX]);
    // Second call returns additional fix
    const secondFix: ProposedFix = { ref_id: "fix-2", rerun_status: "improved" };
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ fixes: [MOCK_FIX, secondFix] }),
    } as Response);

    const { result } = renderHook(() => useProposedFixes(runId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.fixes).toHaveLength(1);

    // Manually trigger refetch
    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.fixes).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not fetch when slug is undefined", async () => {
    const { useWorkspace } = await import("@/hooks/useWorkspace");
    vi.mocked(useWorkspace).mockReturnValueOnce({ workspace: null } as ReturnType<typeof useWorkspace>);

    const { result } = renderHook(() => useProposedFixes(runId));

    // Should remain in initial state (not loading, no fetch fired)
    expect(result.current.isLoading).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("does not fetch when runId is empty", async () => {
    const { result } = renderHook(() => useProposedFixes(""));

    expect(result.current.isLoading).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("handles a network-level fetch rejection gracefully", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Network error"));
    const { result } = renderHook(() => useProposedFixes(runId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Network error");
    expect(result.current.fixes).toEqual([]);
  });
});
