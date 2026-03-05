import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useRepoBranches } from "@/hooks/useRepoBranches";

const REPO_URL = "https://github.com/test/repo";
const WORKSPACE_SLUG = "test-workspace";

const MOCK_BRANCHES = [
  { name: "main", sha: "abc123" },
  { name: "dev", sha: "def456" },
];

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
});
