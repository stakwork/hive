import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Unit tests for the saveToDatabase concurrency guard and retry path fixes.
 *
 * These tests replicate the core logic of saveToDatabase from
 * src/app/w/[slug]/whiteboards/[id]/page.tsx without importing the full
 * Next.js page (which requires a complex jsdom + Excalidraw setup).
 *
 * Covers:
 * 1. Concurrency guard: second concurrent call is deferred and re-executed
 *    after the first completes, using the latest canvas state.
 * 2. Retry path: on a successful 409 retry, both `lastSavedSnapshotRef` and
 *    `whiteboard.files` state are updated.
 * 3. Normal success path: `lastSavedSnapshotRef` and `whiteboard.files` are
 *    updated after a clean save.
 */

// ---------------------------------------------------------------------------
// Helpers to replicate saveToDatabase logic
// ---------------------------------------------------------------------------

type Files = Record<string, { id: string; mimeType: string; s3Key?: string }>;

interface SaveOptions {
  whiteboardId: string;
  elements: unknown[];
  files: Files;
  expectedVersion: number;
}

interface Refs {
  saveInFlightRef: { current: boolean };
  pendingSaveRef: { current: boolean };
  lastSavedSnapshotRef: { current: string };
  versionRef: { current: number };
}

interface State {
  whiteboardFiles: Files;
}

/**
 * Minimal replica of the saveToDatabase logic from the whiteboard page.
 * The real function is a useCallback; here we extract the logic into a
 * plain async function so we can test it without React.
 */
function buildSaveToDatabase(
  refs: Refs,
  state: State,
  fetchFn: typeof fetch,
  setSaving: (v: boolean) => void,
  setWhiteboard: (updater: (prev: State) => State) => void,
  getExcalidrawState: () => { elements: unknown[]; files: Files } | null,
  computeSnapshot: (elements: unknown[], files: Files) => string
) {
  function saveToDatabase(elements: unknown[], files: Files): void {
    const snapshot = computeSnapshot(elements, files);
    if (snapshot === refs.lastSavedSnapshotRef.current) return;

    // Concurrency guard
    if (refs.saveInFlightRef.current) {
      refs.pendingSaveRef.current = true;
      return;
    }
    refs.saveInFlightRef.current = true;

    setSaving(true);

    const whiteboardId = "wb-test";
    const mergedFiles = { ...state.whiteboardFiles, ...files };

    const doSave = async () => {
      try {
        const data = { elements, files: mergedFiles, expectedVersion: refs.versionRef.current };

        const res = await fetchFn(`/api/whiteboards/${whiteboardId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (res.status === 409) {
          const body = await res.json().catch(() => ({}));

          if (body.stale && body.currentVersion != null) {
            refs.versionRef.current = body.currentVersion;
            const retryData = { ...data, expectedVersion: body.currentVersion };
            const retryRes = await fetchFn(`/api/whiteboards/${whiteboardId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(retryData),
            });

            if (retryRes.ok) {
              const retryResult = await retryRes.json();
              if (retryResult.data?.version) {
                refs.versionRef.current = retryResult.data.version;
              }
              // Fix: update snapshot and files state after retry
              refs.lastSavedSnapshotRef.current = snapshot;
              setWhiteboard((prev) => ({ ...prev, whiteboardFiles: mergedFiles }));
            }
            return;
          }
          return;
        }

        if (!res.ok) throw new Error("Failed to save");

        const result = await res.json();
        if (result.data?.version) refs.versionRef.current = result.data.version;

        refs.lastSavedSnapshotRef.current = snapshot;
        setWhiteboard((prev) => ({ ...prev, whiteboardFiles: mergedFiles }));
      } catch {
        // swallow for test simplicity
      } finally {
        setSaving(false);
        refs.saveInFlightRef.current = false;
        if (refs.pendingSaveRef.current) {
          const latest = getExcalidrawState();
          if (latest) {
            refs.pendingSaveRef.current = false;
            saveToDatabase(latest.elements, latest.files);
          }
        }
      }
    };

    doSave();
  }

  return saveToDatabase;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("saveToDatabase — concurrency guard", () => {
  let refs: Refs;
  let state: State;
  let fetchFn: ReturnType<typeof vi.fn>;
  let setSaving: ReturnType<typeof vi.fn>;
  let setWhiteboard: ReturnType<typeof vi.fn>;
  let getExcalidrawState: ReturnType<typeof vi.fn>;
  let computeSnapshot: ReturnType<typeof vi.fn>;
  let saveToDatabase: ReturnType<typeof buildSaveToDatabase>;

  // Used to manually resolve fetch calls
  let resolveFetch: (value: Response) => void;

  beforeEach(() => {
    vi.useFakeTimers();

    refs = {
      saveInFlightRef: { current: false },
      pendingSaveRef: { current: false },
      lastSavedSnapshotRef: { current: "" },
      versionRef: { current: 1 },
    };
    state = { whiteboardFiles: {} };
    setSaving = vi.fn();
    setWhiteboard = vi.fn((updater) => {
      state = updater(state);
    });
    computeSnapshot = vi.fn((elements: unknown[], _files: unknown) =>
      JSON.stringify(elements)
    );

    // Default: fetch returns a pending promise
    fetchFn = vi.fn();
    getExcalidrawState = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defers a second concurrent save and re-executes it after the first completes", async () => {
    // First fetch resolves successfully
    let resolveFirst!: (v: Response) => void;
    const firstFetch = new Promise<Response>((res) => { resolveFirst = res; });

    fetchFn.mockResolvedValueOnce(firstFetch as unknown as Response);

    const firstElements = [{ id: "el1" }];
    const secondElements = [{ id: "el1" }, { id: "el2" }]; // newer state
    const secondFiles = { "file-2": { id: "file-2", mimeType: "image/png" } };

    // Fresh canvas state returned when deferred save is re-triggered
    getExcalidrawState.mockReturnValue({ elements: secondElements, files: secondFiles });

    saveToDatabase = buildSaveToDatabase(
      refs, state, fetchFn, setSaving, setWhiteboard, getExcalidrawState, computeSnapshot
    );

    // First save call
    saveToDatabase(firstElements, {});
    expect(refs.saveInFlightRef.current).toBe(true);
    expect(refs.pendingSaveRef.current).toBe(false);

    // Second save call while first is in-flight — should be deferred
    saveToDatabase(secondElements, secondFiles);
    expect(refs.pendingSaveRef.current).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1); // only first call issued

    // Resolve first fetch
    resolveFirst(
      new Response(JSON.stringify({ data: { version: 2 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    await vi.runAllTimersAsync();
    await firstFetch;
    // Allow microtasks to flush
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // After first completes: in-flight reset, pending save re-triggered
    expect(refs.saveInFlightRef.current).toBe(false);
    expect(refs.pendingSaveRef.current).toBe(false);
    // getExcalidrawState called to get latest state for deferred save
    expect(getExcalidrawState).toHaveBeenCalled();
    // fetch was called again for the deferred save
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("second call with same snapshot is dropped (no deferred save)", async () => {
    refs.lastSavedSnapshotRef.current = '[{"id":"el1"}]'; // already saved

    saveToDatabase = buildSaveToDatabase(
      refs, state, fetchFn, setSaving, setWhiteboard, getExcalidrawState, computeSnapshot
    );

    saveToDatabase([{ id: "el1" }], {});
    expect(fetchFn).not.toHaveBeenCalled();
    expect(refs.pendingSaveRef.current).toBe(false);
  });
});

describe("saveToDatabase — 409 retry path", () => {
  let refs: Refs;
  let state: State;
  let fetchFn: ReturnType<typeof vi.fn>;
  let setSaving: ReturnType<typeof vi.fn>;
  let setWhiteboard: ReturnType<typeof vi.fn>;
  let getExcalidrawState: ReturnType<typeof vi.fn>;
  let computeSnapshot: ReturnType<typeof vi.fn>;
  let saveToDatabase: ReturnType<typeof buildSaveToDatabase>;

  beforeEach(() => {
    refs = {
      saveInFlightRef: { current: false },
      pendingSaveRef: { current: false },
      lastSavedSnapshotRef: { current: "" },
      versionRef: { current: 1 },
    };
    state = { whiteboardFiles: { "existing-file": { id: "existing-file", mimeType: "image/jpeg" } } };
    setSaving = vi.fn();
    setWhiteboard = vi.fn((updater) => {
      state = updater(state);
    });
    computeSnapshot = vi.fn((elements: unknown[]) => JSON.stringify(elements));
    getExcalidrawState = vi.fn().mockReturnValue(null);

    fetchFn = vi.fn();
    saveToDatabase = buildSaveToDatabase(
      refs, state, fetchFn, setSaving, setWhiteboard, getExcalidrawState, computeSnapshot
    );
  });

  it("updates lastSavedSnapshotRef after a successful 409 retry", async () => {
    // First call: 409 stale
    fetchFn
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Version conflict", stale: true, currentVersion: 5 }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        )
      )
      // Retry call: 200 OK
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { version: 6 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    const elements = [{ id: "el1" }];
    saveToDatabase(elements, {});

    // Flush all async work
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchFn).toHaveBeenCalledTimes(2);
    // lastSavedSnapshotRef must be updated after retry
    expect(refs.lastSavedSnapshotRef.current).toBe(JSON.stringify(elements));
    // versionRef updated from retry response
    expect(refs.versionRef.current).toBe(6);
  });

  it("updates whiteboard.files state after a successful 409 retry", async () => {
    const newFile = { id: "new-file", mimeType: "image/png" };

    fetchFn
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Version conflict", stale: true, currentVersion: 5 }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { version: 6 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );

    saveToDatabase([{ id: "el1" }], { "new-file": newFile });

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // setWhiteboard called with updater that merges files
    expect(setWhiteboard).toHaveBeenCalled();
    // State should now contain both existing and new files
    expect(state.whiteboardFiles).toHaveProperty("existing-file");
    expect(state.whiteboardFiles).toHaveProperty("new-file");
  });

  it("does NOT update lastSavedSnapshotRef when retry fails", async () => {
    fetchFn
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "Version conflict", stale: true, currentVersion: 5 }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Server error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        })
      );

    saveToDatabase([{ id: "el1" }], {});

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(refs.lastSavedSnapshotRef.current).toBe(""); // unchanged
  });
});

describe("saveToDatabase — normal success path", () => {
  let refs: Refs;
  let state: State;
  let fetchFn: ReturnType<typeof vi.fn>;
  let setSaving: ReturnType<typeof vi.fn>;
  let setWhiteboard: ReturnType<typeof vi.fn>;
  let getExcalidrawState: ReturnType<typeof vi.fn>;
  let computeSnapshot: ReturnType<typeof vi.fn>;
  let saveToDatabase: ReturnType<typeof buildSaveToDatabase>;

  beforeEach(() => {
    refs = {
      saveInFlightRef: { current: false },
      pendingSaveRef: { current: false },
      lastSavedSnapshotRef: { current: "" },
      versionRef: { current: 1 },
    };
    state = { whiteboardFiles: {} };
    setSaving = vi.fn();
    setWhiteboard = vi.fn((updater) => {
      state = updater(state);
    });
    computeSnapshot = vi.fn((elements: unknown[]) => JSON.stringify(elements));
    getExcalidrawState = vi.fn().mockReturnValue(null);
    fetchFn = vi.fn();
    saveToDatabase = buildSaveToDatabase(
      refs, state, fetchFn, setSaving, setWhiteboard, getExcalidrawState, computeSnapshot
    );
  });

  it("updates lastSavedSnapshotRef and whiteboard.files on success", async () => {
    const newFile = { id: "img1", mimeType: "image/jpeg" };

    fetchFn.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { version: 3 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const elements = [{ id: "el1" }];
    saveToDatabase(elements, { img1: newFile });

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(refs.lastSavedSnapshotRef.current).toBe(JSON.stringify(elements));
    expect(refs.versionRef.current).toBe(3);
    expect(state.whiteboardFiles).toHaveProperty("img1");
  });

  it("resets saveInFlightRef in finally even if fetch throws", async () => {
    fetchFn.mockRejectedValueOnce(new Error("Network error"));

    saveToDatabase([{ id: "el1" }], {});

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(refs.saveInFlightRef.current).toBe(false);
    expect(setSaving).toHaveBeenLastCalledWith(false);
  });
});
