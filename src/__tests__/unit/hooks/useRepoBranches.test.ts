import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRepoBranches } from "@/hooks/useRepoBranches";

const REPO_URL = "https://github.com/test/repo";
const WORKSPACE_SLUG = "test-workspace";

const MOCK_BRANCHES = [
  { name: "main", sha: "abc123" },
  { name: "dev", sha: "def456" },
];

/** Build an array of N mock branches */
function makeBranches(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    name: `branch-${offset + i}`,
    sha: `sha-${offset + i}`,
  }));
}

describe("useRepoBranches", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not fetch on mount — requires explicit fetchBranches call", () => {
    renderHook(() => useRepoBranches(REPO_URL, WORKSPACE_SLUG));

    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches branches and returns them when fetchBranches is called", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ branches: MOCK_BRANCHES, total_count: 2 }),
    } as Response);

    const { result } = renderHook(() =>
      useRepoBranches(REPO_URL, WORKSPACE_SLUG),
    );

    act(() => { result.current.fetchBranches(); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.branches).toEqual(MOCK_BRANCHES);
    expect(result.current.error).toBeNull();
    // Single page (< 100 items) — only one fetch call
    expect(fetch).toHaveBeenCalledTimes(1);
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("page=1");
    expect(calledUrl).toContain("per_page=100");
  });

  it("sets isLoading true during fetch and false after", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { result } = renderHook(() =>
      useRepoBranches(REPO_URL, WORKSPACE_SLUG),
    );

    act(() => { result.current.fetchBranches(); });

    expect(result.current.isLoading).toBe(true);

    resolveFetch({
      ok: true,
      json: async () => ({ branches: MOCK_BRANCHES }),
    } as Response);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("sets error and returns empty branches on fetch failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      statusText: "Internal Server Error",
      json: async () => ({}),
    } as Response);

    const { result } = renderHook(() =>
      useRepoBranches(REPO_URL, WORKSPACE_SLUG),
    );

    act(() => { result.current.fetchBranches(); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.branches).toEqual([]);
    expect(result.current.error).toContain("Failed to fetch branches");
  });

  it("sets error and returns empty branches on network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    const { result } = renderHook(() =>
      useRepoBranches(REPO_URL, WORKSPACE_SLUG),
    );

    act(() => { result.current.fetchBranches(); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.branches).toEqual([]);
    expect(result.current.error).toBe("Network error");
  });

  it("does not fetch when repoUrl is null", () => {
    const { result } = renderHook(() =>
      useRepoBranches(null, WORKSPACE_SLUG),
    );

    act(() => { result.current.fetchBranches(); });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.branches).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not fetch when workspaceSlug is null", () => {
    const { result } = renderHook(() =>
      useRepoBranches(REPO_URL, null),
    );

    act(() => { result.current.fetchBranches(); });

    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.branches).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("re-fetches when repoUrl changes and fetchBranches is called again", async () => {
    const branches1 = [{ name: "main", sha: "aaa" }];
    const branches2 = [{ name: "feature", sha: "bbb" }];

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: branches1 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: branches2 }),
      } as Response);

    const { result, rerender } = renderHook(
      ({ repoUrl }: { repoUrl: string }) =>
        useRepoBranches(repoUrl, WORKSPACE_SLUG),
      { initialProps: { repoUrl: REPO_URL } },
    );

    act(() => { result.current.fetchBranches(); });
    await waitFor(() => expect(result.current.branches).toEqual(branches1));

    rerender({ repoUrl: "https://github.com/test/other-repo" });

    act(() => { result.current.fetchBranches(); });
    await waitFor(() => expect(result.current.branches).toEqual(branches2));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // --- Pagination tests ---

  it("fetches multiple pages and accumulates all branches (100 + 40 = 140)", async () => {
    const page1 = makeBranches(100, 0);
    const page2 = makeBranches(40, 100);

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: page1 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: page2 }),
      } as Response);

    const { result } = renderHook(() =>
      useRepoBranches(REPO_URL, WORKSPACE_SLUG),
    );

    act(() => { result.current.fetchBranches(); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.branches).toHaveLength(140);
    expect(result.current.branches).toEqual([...page1, ...page2]);
    expect(fetch).toHaveBeenCalledTimes(2);

    const call1Url = vi.mocked(fetch).mock.calls[0][0] as string;
    const call2Url = vi.mocked(fetch).mock.calls[1][0] as string;
    expect(call1Url).toContain("page=1");
    expect(call2Url).toContain("page=2");
    expect(call1Url).toContain("per_page=100");
    expect(call2Url).toContain("per_page=100");
  });

  it("continues fetching when page returns exactly 100 items, stops on empty next page", async () => {
    const page1 = makeBranches(100, 0);

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: page1 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: [] }),
      } as Response);

    const { result } = renderHook(() =>
      useRepoBranches(REPO_URL, WORKSPACE_SLUG),
    );

    act(() => { result.current.fetchBranches(); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.branches).toHaveLength(100);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops after one fetch when page 1 returns fewer than 100 items", async () => {
    const page1 = makeBranches(42, 0);

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ branches: page1 }),
    } as Response);

    const { result } = renderHook(() =>
      useRepoBranches(REPO_URL, WORKSPACE_SLUG),
    );

    act(() => { result.current.fetchBranches(); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.branches).toHaveLength(42);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fetches three pages and accumulates all branches (100 + 100 + 50 = 250)", async () => {
    const page1 = makeBranches(100, 0);
    const page2 = makeBranches(100, 100);
    const page3 = makeBranches(50, 200);

    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: page1 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: page2 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: page3 }),
      } as Response);

    const { result } = renderHook(() =>
      useRepoBranches(REPO_URL, WORKSPACE_SLUG),
    );

    act(() => { result.current.fetchBranches(); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.branches).toHaveLength(250);
    expect(fetch).toHaveBeenCalledTimes(3);

    const call3Url = vi.mocked(fetch).mock.calls[2][0] as string;
    expect(call3Url).toContain("page=3");
  });

  it("does not re-fetch for the same repoUrl + workspaceSlug (cache)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ branches: MOCK_BRANCHES }),
    } as Response);

    const { result } = renderHook(() =>
      useRepoBranches(REPO_URL, WORKSPACE_SLUG),
    );

    act(() => { result.current.fetchBranches(); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Second call — should be a no-op due to cache
    act(() => { result.current.fetchBranches(); });

    // Still only 1 fetch total
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.current.branches).toEqual(MOCK_BRANCHES);
  });
});
