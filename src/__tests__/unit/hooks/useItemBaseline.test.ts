import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useItemBaseline } from "@/hooks/useItemBaseline";

// ── Mock fetch globally ───────────────────────────────────────────────────────

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

function ok(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response);
}

function fail(status = 500) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ error: "Server error" }),
  } as Response);
}

// ── Prompt fixtures ───────────────────────────────────────────────────────────

const PROMPT_VERSIONS_RESPONSE = {
  success: true,
  data: {
    prompt_id: "prompt-abc",
    prompt_name: "MY_PROMPT",
    versions: [
      { id: "v3", value: "updated prompt text", published: false, version_number: 3 },
      { id: "v2", value: "published prompt text", published: true, version_number: 2 },
      { id: "v1", value: "old prompt text", published: false, version_number: 1 },
    ],
    published_version_id: "v2",
    current_version_id: "v3",
  },
};

// ── Script fixtures ───────────────────────────────────────────────────────────

const SCRIPT_VERSIONS_LIST_RESPONSE = {
  success: true,
  data: {
    versions: [
      { id: 30, name: "v3" },
      { id: 20, name: "v2" },
    ],
    published_version_id: 20,
  },
};

const SCRIPT_VERSION_20_RESPONSE = {
  success: true,
  data: { id: 20, value: "published source code", source_code: "published source code" },
};

const SCRIPT_VERSION_30_RESPONSE = {
  success: true,
  data: { id: 30, value: "updated source code", source_code: "updated source code" },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useItemBaseline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── PROMPT path ─────────────────────────────────────────────────────────────

  describe("PROMPT path", () => {
    it("resolves baseline and updated from a single /versions call", async () => {
      mockFetch.mockReturnValueOnce(ok(PROMPT_VERSIONS_RESPONSE));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "PROMPT", promptId: "prompt-abc", promptVersionId: "v3" }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith("/api/workflow/prompts/prompt-abc/versions");

      expect(result.current.baseline).toBe("published prompt text");
      expect(result.current.updated).toBe("updated prompt text");
      expect(result.current.error).toBeNull();
    });

    it("resolves baseline: null when published_version_id is null", async () => {
      const noPublished = {
        ...PROMPT_VERSIONS_RESPONSE,
        data: { ...PROMPT_VERSIONS_RESPONSE.data, published_version_id: null },
      };
      mockFetch.mockReturnValueOnce(ok(noPublished));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "PROMPT", promptId: "prompt-abc", promptVersionId: "v3" }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      expect(result.current.updated).toBe("updated prompt text");
      expect(result.current.error).toBeNull();
    });

    it("resolves updated: null and sets error when promptVersionId not found", async () => {
      const noMatch = {
        ...PROMPT_VERSIONS_RESPONSE,
        data: {
          ...PROMPT_VERSIONS_RESPONSE.data,
          versions: PROMPT_VERSIONS_RESPONSE.data.versions.filter((v) => v.id !== "v3"),
        },
      };
      mockFetch.mockReturnValueOnce(ok(noMatch));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "PROMPT", promptId: "prompt-abc", promptVersionId: "v3" }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.updated).toBeNull();
      expect(result.current.error).toBeTruthy();
    });

    it("resolves baseline: null and calls console.error on fetch failure", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockReturnValueOnce(fail(500));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "PROMPT", promptId: "prompt-abc", promptVersionId: "v3" }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      expect(result.current.updated).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("never throws on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network down"));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "PROMPT", promptId: "prompt-abc", promptVersionId: "v3" }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Must resolve gracefully without throwing
      expect(result.current.baseline).toBeNull();
      expect(result.current.error).toBeTruthy();
    });

    it("refetches when promptId changes", async () => {
      mockFetch.mockReturnValue(ok(PROMPT_VERSIONS_RESPONSE));

      const { result, rerender } = renderHook(
        ({ promptId }: { promptId: string }) =>
          useItemBaseline({ type: "PROMPT", promptId, promptVersionId: "v3" }),
        { initialProps: { promptId: "prompt-abc" } },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockFetch).toHaveBeenCalledTimes(1);

      rerender({ promptId: "prompt-xyz" });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith("/api/workflow/prompts/prompt-xyz/versions");
    });
  });

  // ── SCRIPT path ─────────────────────────────────────────────────────────────

  describe("SCRIPT path", () => {
    it("resolves baseline and updated via list + two parallel fetches", async () => {
      // Call 1: versions list
      mockFetch.mockReturnValueOnce(ok(SCRIPT_VERSIONS_LIST_RESPONSE));
      // Calls 2 & 3 (parallel): published version + updated version
      mockFetch.mockReturnValueOnce(ok(SCRIPT_VERSION_20_RESPONSE));
      mockFetch.mockReturnValueOnce(ok(SCRIPT_VERSION_30_RESPONSE));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "SCRIPT", scriptId: 1, scriptVersionId: 30 }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // 3 total fetch calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenCalledWith("/api/workflow/scripts/1/versions");
      expect(mockFetch).toHaveBeenCalledWith("/api/workflow/scripts/1/versions/20");
      expect(mockFetch).toHaveBeenCalledWith("/api/workflow/scripts/1/versions/30");

      expect(result.current.baseline).toBe("published source code");
      expect(result.current.updated).toBe("updated source code");
      expect(result.current.error).toBeNull();
    });

    it("resolves baseline: null when published_version_id is null", async () => {
      const noPub = {
        ...SCRIPT_VERSIONS_LIST_RESPONSE,
        data: { ...SCRIPT_VERSIONS_LIST_RESPONSE.data, published_version_id: null },
      };
      mockFetch.mockReturnValueOnce(ok(noPub));
      // Only one parallel fetch (for updated)
      mockFetch.mockReturnValueOnce(ok(SCRIPT_VERSION_30_RESPONSE));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "SCRIPT", scriptId: 1, scriptVersionId: 30 }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      expect(result.current.updated).toBe("updated source code");
      expect(result.current.error).toBeNull();
    });

    it("resolves baseline: null and console.error when baseline version fetch fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockReturnValueOnce(ok(SCRIPT_VERSIONS_LIST_RESPONSE));
      // Baseline fetch fails; updated fetch succeeds
      mockFetch.mockReturnValueOnce(fail(404));
      mockFetch.mockReturnValueOnce(ok(SCRIPT_VERSION_30_RESPONSE));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "SCRIPT", scriptId: 1, scriptVersionId: 30 }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      expect(result.current.updated).toBe("updated source code");
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("sets error when updated version fetch fails", async () => {
      mockFetch.mockReturnValueOnce(ok(SCRIPT_VERSIONS_LIST_RESPONSE));
      mockFetch.mockReturnValueOnce(ok(SCRIPT_VERSION_20_RESPONSE));
      // Updated fetch fails
      mockFetch.mockReturnValueOnce(fail(500));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "SCRIPT", scriptId: 1, scriptVersionId: 30 }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.updated).toBeNull();
      expect(result.current.error).toBeTruthy();
    });

    it("resolves baseline: null and console.error when versions list fetch fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockFetch.mockReturnValueOnce(fail(503));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "SCRIPT", scriptId: 1, scriptVersionId: 30 }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      expect(result.current.updated).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("never throws on complete network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network down"));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "SCRIPT", scriptId: 1, scriptVersionId: 30 }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.baseline).toBeNull();
      expect(result.current.error).toBeTruthy();
    });

    it("refetches when scriptVersionId changes", async () => {
      mockFetch.mockReturnValue(ok(SCRIPT_VERSIONS_LIST_RESPONSE));
      // For each render: list + two version fetches = 3 calls
      mockFetch
        .mockReturnValueOnce(ok(SCRIPT_VERSIONS_LIST_RESPONSE))
        .mockReturnValueOnce(ok(SCRIPT_VERSION_20_RESPONSE))
        .mockReturnValueOnce(ok(SCRIPT_VERSION_30_RESPONSE))
        .mockReturnValueOnce(ok(SCRIPT_VERSIONS_LIST_RESPONSE))
        .mockReturnValueOnce(ok(SCRIPT_VERSION_20_RESPONSE))
        .mockReturnValueOnce(ok({ success: true, data: { value: "newer source" } }));

      const { result, rerender } = renderHook(
        ({ vid }: { vid: number }) =>
          useItemBaseline({ type: "SCRIPT", scriptId: 1, scriptVersionId: vid }),
        { initialProps: { vid: 30 } },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      const firstCallCount = mockFetch.mock.calls.length;

      rerender({ vid: 31 });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(mockFetch.mock.calls.length).toBeGreaterThan(firstCallCount);
    });
  });

  // ── isLoading state ──────────────────────────────────────────────────────────

  describe("isLoading state", () => {
    it("starts with isLoading: true", () => {
      // Return a never-resolving promise so we can check the initial state
      mockFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() =>
        useItemBaseline({ type: "PROMPT", promptId: "p1", promptVersionId: "v1" }),
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.baseline).toBeNull();
      expect(result.current.updated).toBeNull();
    });
  });
});
