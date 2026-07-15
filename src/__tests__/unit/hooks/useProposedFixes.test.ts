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

function mockPatchSuccess() {
  vi.mocked(global.fetch).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ status: "ok" }),
  } as Response);
}

function mockPatchError(status = 500, body: Record<string, unknown> = { error: "Publish failed" }) {
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

  // ─── Fetch behavior ────────────────────────────────────────────────────────

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
    const secondFix: ProposedFix = { ref_id: "fix-2", rerun_status: "improved" };
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ fixes: [MOCK_FIX, secondFix] }),
    } as Response);

    const { result } = renderHook(() => useProposedFixes(runId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.fixes).toHaveLength(1);

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

  // ─── accept() / reject() ──────────────────────────────────────────────────

  it("exposes accept, reject, and pendingRefIds on result", async () => {
    mockFetchSuccess([]);
    const { result } = renderHook(() => useProposedFixes(runId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(typeof result.current.accept).toBe("function");
    expect(typeof result.current.reject).toBe("function");
    expect(result.current.pendingRefIds).toBeInstanceOf(Set);
    expect(result.current.pendingRefIds.size).toBe(0);
  });

  it("accept: PATCHes the correct URL with action=accept then refetches", async () => {
    mockFetchSuccess([MOCK_FIX]);
    mockPatchSuccess();
    const updatedFix: ProposedFix = { ...MOCK_FIX, status: "accepted" };
    mockFetchSuccess([updatedFix]);

    const { result } = renderHook(() => useProposedFixes(runId));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.accept("fix-1");
    });

    // Initial GET, PATCH, refetch GET
    expect(global.fetch).toHaveBeenCalledTimes(3);

    const patchCall = vi.mocked(global.fetch).mock.calls[1];
    expect(patchCall[0]).toBe(
      "/api/workspaces/openlaw/legal/benchmarks/proposed-fixes/fix-1",
    );
    expect(patchCall[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ action: "accept" }),
    });

    expect(result.current.fixes[0].status).toBe("accepted");
  });

  it("reject: PATCHes the correct URL with action=reject then refetches", async () => {
    mockFetchSuccess([MOCK_FIX]);
    mockPatchSuccess();
    mockFetchSuccess([]);

    const { result } = renderHook(() => useProposedFixes(runId));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.reject("fix-1");
    });

    const patchCall = vi.mocked(global.fetch).mock.calls[1];
    expect(patchCall[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ action: "reject" }),
    });

    expect(result.current.fixes).toHaveLength(0);
  });

  it("accept: double-click is a no-op — does not PATCH twice", async () => {
    mockFetchSuccess([MOCK_FIX]);
    mockPatchSuccess();
    mockFetchSuccess([]);

    const { result } = renderHook(() => useProposedFixes(runId));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Call accept twice rapidly (synchronously back-to-back) — second is no-op
    await act(async () => {
      const p1 = result.current.accept("fix-1");
      const p2 = result.current.accept("fix-1"); // should be no-op
      await Promise.all([p1, p2]);
    });

    const patchCalls = vi.mocked(global.fetch).mock.calls.filter(
      (call) => call[1] && (call[1] as RequestInit).method === "PATCH",
    );
    expect(patchCalls).toHaveLength(1);
  });

  it("accept: failed PATCH surfaces an error without crashing", async () => {
    mockFetchSuccess([MOCK_FIX]);
    mockPatchError(500, { error: "Publish failed" });

    const { result } = renderHook(() => useProposedFixes(runId));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let thrown: Error | null = null;
    await act(async () => {
      try {
        await result.current.accept("fix-1");
      } catch (e) {
        thrown = e as Error;
      }
    });

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toBe("Publish failed");
    // pendingRefIds cleared even after error
    expect(result.current.pendingRefIds.has("fix-1")).toBe(false);
    // fixes unchanged (no refetch on error)
    expect(result.current.fixes).toHaveLength(1);
  });

  it("reject: failed PATCH surfaces an error without crashing", async () => {
    mockFetchSuccess([MOCK_FIX]);
    mockPatchError(400, { error: "Bad action" });

    const { result } = renderHook(() => useProposedFixes(runId));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let thrown: Error | null = null;
    await act(async () => {
      try {
        await result.current.reject("fix-1");
      } catch (e) {
        thrown = e as Error;
      }
    });

    expect(thrown).not.toBeNull();
    expect(thrown!.message).toBe("Bad action");
    expect(result.current.pendingRefIds.has("fix-1")).toBe(false);
  });
});
