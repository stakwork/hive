/**
 * Unit tests for the BrowserArtifactPanel IDE auto-login logic.
 *
 * Rather than mounting the full component (which has a large dependency surface),
 * we extract and test the `ideAuthUrl` state machine logic using renderHook — the
 * same approach used in ArtifactsPanel.test.tsx for race-condition coverage.
 */
import { describe, test, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useState, useEffect } from "react";

// ── ideAuthUrl hook — mirrors the exact logic in BrowserArtifactPanel ─────────

interface IdeAuthUrlOptions {
  ide?: boolean;
  isUrlReady: boolean;
  taskId?: string;
  fallbackUrl?: string;
}

function useIdeAuthUrl({ ide, isUrlReady, taskId, fallbackUrl }: IdeAuthUrlOptions) {
  const [ideAuthUrl, setIdeAuthUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!ide || !isUrlReady || !taskId || ideAuthUrl !== null) return;

    (async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/ide-token`, { method: "POST" });
        if (!res.ok) throw new Error("ide-token fetch failed");
        const { token, expires, ideUrl } = await res.json();
        if (token) {
          setIdeAuthUrl(`${ideUrl}/ide-auth?token=${token}&expires=${expires}`);
        } else {
          setIdeAuthUrl(fallbackUrl ?? null);
        }
      } catch {
        setIdeAuthUrl(fallbackUrl ?? null);
      }
    })();
  }, [ide, isUrlReady, taskId, ideAuthUrl, fallbackUrl]);

  return { ideAuthUrl, setIdeAuthUrl };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BrowserArtifactPanel — IDE auto-login (ideAuthUrl logic)", () => {
  const TASK_ID = "task-1";
  const IDE_URL = "https://pod-abc.workspaces.sphinx.chat";
  const TOKEN = "deadbeef".repeat(8); // 64-char hex
  const EXPIRES = Math.floor(Date.now() / 1000) + 55;
  const FALLBACK_URL = "https://pod-abc.workspaces.sphinx.chat";

  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── Guarding conditions ────────────────────────────────────────────────────

  test("does not fetch when ide=false", async () => {
    renderHook(() =>
      useIdeAuthUrl({ ide: false, isUrlReady: true, taskId: TASK_ID, fallbackUrl: FALLBACK_URL })
    );
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not fetch when isUrlReady=false", async () => {
    renderHook(() =>
      useIdeAuthUrl({ ide: true, isUrlReady: false, taskId: TASK_ID, fallbackUrl: FALLBACK_URL })
    );
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not fetch when taskId is missing", async () => {
    renderHook(() =>
      useIdeAuthUrl({ ide: true, isUrlReady: true, taskId: undefined, fallbackUrl: FALLBACK_URL })
    );
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not fetch again once ideAuthUrl is already set", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: TOKEN, expires: EXPIRES, ideUrl: IDE_URL }),
    });

    const { result } = renderHook(() =>
      useIdeAuthUrl({ ide: true, isUrlReady: true, taskId: TASK_ID, fallbackUrl: FALLBACK_URL })
    );

    await waitFor(() => expect(result.current.ideAuthUrl).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Re-render cycle (simulate parent re-render) — should not trigger another fetch
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  test("sets ideAuthUrl to /ide-auth URL when token is returned", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: TOKEN, expires: EXPIRES, ideUrl: IDE_URL }),
    });

    const { result } = renderHook(() =>
      useIdeAuthUrl({ ide: true, isUrlReady: true, taskId: TASK_ID, fallbackUrl: FALLBACK_URL })
    );

    await waitFor(() => expect(result.current.ideAuthUrl).not.toBeNull());

    expect(result.current.ideAuthUrl).toBe(
      `${IDE_URL}/ide-auth?token=${TOKEN}&expires=${EXPIRES}`
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tasks/${TASK_ID}/ide-token`,
      { method: "POST" }
    );
  });

  // ── Fallback scenarios ─────────────────────────────────────────────────────

  test("falls back to content.url when api returns token: null (no agentPassword)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: null }),
    });

    const { result } = renderHook(() =>
      useIdeAuthUrl({ ide: true, isUrlReady: true, taskId: TASK_ID, fallbackUrl: FALLBACK_URL })
    );

    await waitFor(() => expect(result.current.ideAuthUrl).not.toBeNull());
    expect(result.current.ideAuthUrl).toBe(FALLBACK_URL);
  });

  test("falls back to content.url when fetch returns non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    const { result } = renderHook(() =>
      useIdeAuthUrl({ ide: true, isUrlReady: true, taskId: TASK_ID, fallbackUrl: FALLBACK_URL })
    );

    await waitFor(() => expect(result.current.ideAuthUrl).not.toBeNull());
    expect(result.current.ideAuthUrl).toBe(FALLBACK_URL);
  });

  test("falls back to content.url when fetch throws (network error)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Network failure"));

    const { result } = renderHook(() =>
      useIdeAuthUrl({ ide: true, isUrlReady: true, taskId: TASK_ID, fallbackUrl: FALLBACK_URL })
    );

    await waitFor(() => expect(result.current.ideAuthUrl).not.toBeNull());
    expect(result.current.ideAuthUrl).toBe(FALLBACK_URL);
  });

  test("ideAuthUrl starts as null and waits for about:blank guard while fetching", async () => {
    let resolvePromise!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => { resolvePromise = resolve; })
    );

    const { result } = renderHook(() =>
      useIdeAuthUrl({ ide: true, isUrlReady: true, taskId: TASK_ID, fallbackUrl: FALLBACK_URL })
    );

    // While fetch is pending, ideAuthUrl should be null → iframe shows about:blank
    expect(result.current.ideAuthUrl).toBeNull();

    resolvePromise({
      ok: true,
      json: async () => ({ token: TOKEN, expires: EXPIRES, ideUrl: IDE_URL }),
    } as Response);

    await waitFor(() => expect(result.current.ideAuthUrl).not.toBeNull());
    expect(result.current.ideAuthUrl).toContain("/ide-auth?token=");
  });
});
