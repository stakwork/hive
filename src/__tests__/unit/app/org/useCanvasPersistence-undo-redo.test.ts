// @vitest-environment jsdom

/**
 * Unit tests for the undo/redo persistence path in `useCanvasPersistence`.
 *
 * Verifies that `scheduleSave` reads the current snapshot from the in-memory
 * refs and enqueues it for a debounced save — exactly what `handleUndo` and
 * `handleRedo` in `OrgCanvasBackground` rely on.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCanvasPersistence } from "@/app/org/[githubLogin]/connections/useCanvasPersistence";
import type { CanvasData } from "system-canvas-react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/org/test-org",
  useSearchParams: () => new URLSearchParams(),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = fetchMock;
  fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
    if (opts?.method === "PUT") {
      return Promise.resolve({ ok: true });
    }
    // GET — return empty canvas
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ data: { nodes: [], edges: [] } }),
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures — use minimal CanvasData shapes (all fields optional)
// ---------------------------------------------------------------------------

const ROOT_DATA: CanvasData = { nodes: [], edges: [] };
const SUB_DATA: CanvasData  = { nodes: [], edges: [] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPuts(): [string, RequestInit][] {
  return (fetchMock.mock.calls as [string, RequestInit | undefined][]).filter(
    ([, opts]) => opts?.method === "PUT",
  ) as [string, RequestInit][];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useCanvasPersistence – scheduleSave", () => {
  test("scheduleSave for root canvas marks root dirty and triggers a PUT after debounce", async () => {
    const { result } = renderHook(() =>
      useCanvasPersistence({ githubLogin: "test-org" }),
    );

    // Wait for initial root load to complete.
    await act(async () => { await Promise.resolve(); });

    // Prime root state with known data.
    act(() => { result.current.setRoot(ROOT_DATA); });

    // scheduleSave should snapshot root and queue a save.
    act(() => { result.current.scheduleSave(undefined); });

    // No PUT yet — debounce has not fired.
    expect(getPuts()).toHaveLength(0);

    // Advance past the 600 ms autosave window.
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });

    const puts = getPuts();
    expect(puts).toHaveLength(1);
    const [url, opts] = puts[0];
    // Root canvas — no trailing ref segment.
    expect(url).toMatch(/\/api\/orgs\/test-org\/canvas$/);
    const body = JSON.parse(opts.body as string) as { data: unknown };
    expect(body.data).toEqual(ROOT_DATA);
  });

  test("scheduleSave for a sub-canvas ref marks only that ref dirty", async () => {
    const { result } = renderHook(() =>
      useCanvasPersistence({ githubLogin: "test-org" }),
    );

    await act(async () => { await Promise.resolve(); });

    const subRef = "initiative:abc";
    act(() => {
      result.current.setSubCanvases({ [subRef]: SUB_DATA });
    });

    act(() => { result.current.scheduleSave(subRef); });

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });

    const puts = getPuts();
    expect(puts).toHaveLength(1);
    const [url, opts] = puts[0];
    expect(url).toContain(encodeURIComponent(subRef));
    const body = JSON.parse(opts.body as string) as { data: unknown };
    expect(body.data).toEqual(SUB_DATA);
  });

  test("multiple rapid scheduleSave calls collapse into a single PUT (debounce)", async () => {
    const { result } = renderHook(() =>
      useCanvasPersistence({ githubLogin: "test-org" }),
    );

    await act(async () => { await Promise.resolve(); });

    act(() => { result.current.setRoot(ROOT_DATA); });

    // Simulate rapid Cmd+Z presses.
    act(() => {
      result.current.scheduleSave(undefined);
      result.current.scheduleSave(undefined);
      result.current.scheduleSave(undefined);
    });

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });

    expect(getPuts()).toHaveLength(1);
  });

  test("scheduleSave when root is null is a no-op", () => {
    const { result } = renderHook(() =>
      useCanvasPersistence({ githubLogin: "test-org" }),
    );

    // root is null at this point (not yet loaded).
    act(() => { result.current.scheduleSave(undefined); });

    expect(result.current.dirtyRef.current.size).toBe(0);
  });

  test("scheduleSave with unknown sub-canvas ref is a no-op", async () => {
    const { result } = renderHook(() =>
      useCanvasPersistence({ githubLogin: "test-org" }),
    );

    await act(async () => { await Promise.resolve(); });

    act(() => {
      result.current.scheduleSave("initiative:does-not-exist");
    });

    expect(result.current.dirtyRef.current.size).toBe(0);
  });
});

describe("OrgCanvasBackground – handleUndo / handleRedo callback contract", () => {
  /**
   * These tests verify the handler contract by exercising the persistence
   * hook directly (mounting the full canvas component requires a browser
   * environment with SVG support that is out-of-scope for unit tests).
   */

  test("handleUndo calls scheduleSave with undefined for the root canvas", async () => {
    const { result } = renderHook(() =>
      useCanvasPersistence({ githubLogin: "my-org" }),
    );

    await act(async () => { await Promise.resolve(); });

    act(() => { result.current.setRoot(ROOT_DATA); });

    // Mirror exactly what OrgCanvasBackground's handleUndo does.
    const handleUndo = (canvasRef: string | undefined) =>
      result.current.scheduleSave(canvasRef);

    act(() => { handleUndo(undefined); });

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });

    const puts = getPuts();
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toMatch(/\/api\/orgs\/my-org\/canvas$/);
  });

  test("handleRedo calls scheduleSave with the sub-canvas ref", async () => {
    const subRef = "ws:xyz";
    const { result } = renderHook(() =>
      useCanvasPersistence({ githubLogin: "my-org" }),
    );

    await act(async () => { await Promise.resolve(); });

    act(() => {
      result.current.setSubCanvases({ [subRef]: SUB_DATA });
    });

    // Mirror exactly what OrgCanvasBackground's handleRedo does.
    const handleRedo = (canvasRef: string | undefined) =>
      result.current.scheduleSave(canvasRef);

    act(() => { handleRedo(subRef); });

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });

    const puts = getPuts();
    expect(puts).toHaveLength(1);
    expect(puts[0][0]).toContain(encodeURIComponent(subRef));
  });

  test("normal applyMutation and scheduleSave share the same debounce — rapid mix produces one PUT", async () => {
    const { result } = renderHook(() =>
      useCanvasPersistence({ githubLogin: "my-org" }),
    );

    await act(async () => { await Promise.resolve(); });

    act(() => { result.current.setRoot(ROOT_DATA); });

    act(() => {
      // Simulate a normal edit immediately followed by an undo.
      result.current.applyMutation(undefined, (d) => ({ ...d }));
      result.current.scheduleSave(undefined);
    });

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });

    // Both calls target the same key — should collapse to one PUT.
    expect(getPuts()).toHaveLength(1);
  });
});
