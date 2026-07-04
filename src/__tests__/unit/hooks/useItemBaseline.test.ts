import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useItemBaseline } from "@/hooks/useItemBaseline";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown) {
  return Promise.resolve({
    ok: true,
    json: async () => body,
  } as Response);
}

function makeFailResponse(status = 500) {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => ({ error: "Server error" }),
  } as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useItemBaseline", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Prompt path ─────────────────────────────────────────────────────────────

  describe("PROMPT path", () => {
    const input = { type: "PROMPT" as const, promptId: "p1", promptVersionId: "v2" };

    it("resolves baseline and updated from a single fetch call", async () => {
      fetchMock.mockReturnValueOnce(
        makeOkResponse({
          success: true,
          data: {
            versions: [
              { id: "v1", value: "baseline content", published: true },
              { id: "v2", value: "updated content", published: false },
            ],
            published_version_id: "v1",
          },
        }),
      );

      const { result } = renderHook(() => useItemBaseline(input));

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/api/workflow/prompts/p1/versions");
      expect(result.current.baseline).toBe("baseline content");
      expect(result.current.updated).toBe("updated content");
      expect(result.current.error).toBeNull();
    });

    it("sets baseline=null when published_version_id is null", async () => {
      fetchMock.mockReturnValueOnce(
        makeOkResponse({
          success: true,
          data: {
            versions: [{ id: "v2", value: "updated content", published: false }],
            published_version_id: null,
          },
        }),
      );

      const { result } = renderHook(() => useItemBaseline(input));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      expect(result.current.updated).toBe("updated content");
      expect(result.current.error).toBeNull();
    });

    it("sets baseline=null when published_version_id is missing from response", async () => {
      fetchMock.mockReturnValueOnce(
        makeOkResponse({
          success: true,
          data: {
            versions: [{ id: "v2", value: "updated content", published: false }],
            // no published_version_id field
          },
        }),
      );

      const { result } = renderHook(() => useItemBaseline(input));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
    });

    it("sets baseline=null and calls console.error on fetch failure (no throw)", async () => {
      fetchMock.mockReturnValueOnce(makeFailResponse(500));

      const { result } = renderHook(() => useItemBaseline(input));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      expect(result.current.updated).toBeNull();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(console.error).toHaveBeenCalled();
      // Must not throw — hook must remain stable
    });

    it("sets error when the updated version is not in the versions list", async () => {
      fetchMock.mockReturnValueOnce(
        makeOkResponse({
          success: true,
          data: {
            versions: [{ id: "v1", value: "baseline", published: true }],
            published_version_id: "v1",
          },
        }),
      );

      const { result } = renderHook(() => useItemBaseline(input));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.updated).toBeNull();
      expect(result.current.error).toBeTruthy();
    });

    it("sets baseline=null on network error (thrown fetch) without throwing", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network down"));

      const { result } = renderHook(() => useItemBaseline(input));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(console.error).toHaveBeenCalled();
    });
  });

  // ── Script path ─────────────────────────────────────────────────────────────

  describe("SCRIPT path", () => {
    const input = { type: "SCRIPT" as const, scriptId: 42, scriptVersionId: 7 };

    it("fetches versions list then makes two parallel version requests", async () => {
      // 1. versions list
      fetchMock.mockReturnValueOnce(
        makeOkResponse({
          success: true,
          data: { published_version_id: 5 },
        }),
      );
      // 2. baseline version (published)
      fetchMock.mockReturnValueOnce(
        makeOkResponse({ success: true, data: { value: "baseline code" } }),
      );
      // 3. updated version
      fetchMock.mockReturnValueOnce(
        makeOkResponse({ success: true, data: { value: "updated code" } }),
      );

      const { result } = renderHook(() => useItemBaseline(input));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/workflow/scripts/42/versions");
      // Calls 2 and 3 are parallel; both paths must be called
      const calls = fetchMock.mock.calls.map(([url]: [string]) => url);
      expect(calls).toContain("/api/workflow/scripts/42/versions/5");
      expect(calls).toContain("/api/workflow/scripts/42/versions/7");

      expect(result.current.baseline).toBe("baseline code");
      expect(result.current.updated).toBe("updated code");
      expect(result.current.error).toBeNull();
    });

    it("sets baseline=null when published_version_id is missing, still fetches updated", async () => {
      fetchMock.mockReturnValueOnce(
        makeOkResponse({ success: true, data: {} }), // no published_version_id
      );
      // Only the updated version fetch should occur (baseline skipped)
      fetchMock.mockReturnValueOnce(
        makeOkResponse({ success: true, data: { value: "updated code" } }),
      );

      const { result } = renderHook(() => useItemBaseline(input));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      expect(result.current.updated).toBe("updated code");
      expect(result.current.error).toBeNull();
    });

    it("sets baseline=null and calls console.error when versions list fetch fails", async () => {
      fetchMock.mockReturnValueOnce(makeFailResponse(503));

      const { result } = renderHook(() => useItemBaseline(input));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(console.error).toHaveBeenCalled();
    });

    it("sets error and updated=null when updated version fetch fails", async () => {
      fetchMock.mockReturnValueOnce(
        makeOkResponse({ success: true, data: { published_version_id: 5 } }),
      );
      // baseline fetch succeeds
      fetchMock.mockReturnValueOnce(
        makeOkResponse({ success: true, data: { value: "baseline code" } }),
      );
      // updated fetch fails
      fetchMock.mockReturnValueOnce(makeFailResponse(404));

      const { result } = renderHook(() => useItemBaseline(input));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.updated).toBeNull();
      expect(result.current.error).toBeTruthy();
      // baseline still resolved
      expect(result.current.baseline).toBe("baseline code");
    });

    it("sets baseline=null on network error without throwing", async () => {
      fetchMock.mockRejectedValueOnce(new Error("Network error"));

      const { result } = renderHook(() => useItemBaseline(input));
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(console.error).toHaveBeenCalled();
    });
  });

  // ── Refetch on input change ──────────────────────────────────────────────────

  describe("refetch on input change", () => {
    it("re-fetches when promptVersionId changes", async () => {
      const responseBody = (versionId: string) => ({
        success: true,
        data: {
          versions: [
            { id: "v1", value: "baseline", published: true },
            { id: versionId, value: `content for ${versionId}`, published: false },
          ],
          published_version_id: "v1",
        },
      });

      fetchMock.mockReturnValueOnce(makeOkResponse(responseBody("v2")));
      fetchMock.mockReturnValueOnce(makeOkResponse(responseBody("v3")));

      const { result, rerender } = renderHook(
        ({ id }: { id: string }) =>
          useItemBaseline({ type: "PROMPT", promptId: "p1", promptVersionId: id }),
        { initialProps: { id: "v2" } },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.updated).toBe("content for v2");

      rerender({ id: "v3" });
      await waitFor(() => expect(result.current.updated).toBe("content for v3"));

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
