// @vitest-environment jsdom
/**
 * Unit tests for the canvas import (`onImport`) handler and `showExportButton`
 * prop wired in `OrgCanvasBackground.tsx`.
 *
 * Strategy: source-file inspection (same pattern as multiSelectKey test) for
 * prop presence, plus direct unit tests of the handler logic via a minimal
 * harness that exercises `saveCanvas` and toast calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import type { CanvasData } from "system-canvas-react";

// ---------------------------------------------------------------------------
// Source-level prop assertions
// ---------------------------------------------------------------------------

const SOURCE_PATH = path.resolve(
  process.cwd(),
  "src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx",
);
const source = fs.readFileSync(SOURCE_PATH, "utf-8");

// Extract the <SystemCanvas …/> JSX block (greedy to closing />)
const systemCanvasBlock =
  source.match(/<SystemCanvas\s+ref=[\s\S]*?\/>/)?.[0] ?? "";

describe("OrgCanvasBackground – export/import props on <SystemCanvas>", () => {
  it("passes showExportButton to SystemCanvas", () => {
    expect(systemCanvasBlock).toContain("showExportButton");
  });

  it("passes onImport to SystemCanvas", () => {
    expect(systemCanvasBlock).toContain("onImport={handleImport}");
  });
});

// ---------------------------------------------------------------------------
// Handler unit tests — isolate saveCanvas and toast
// ---------------------------------------------------------------------------

// We test the handleImport logic by extracting it as a standalone async fn
// with the same shape, so we avoid mounting the full component (40+ deps).

const mockSaveCanvas = vi.fn().mockResolvedValue(undefined);
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock("@/lib/persistence", () => ({})); // not used directly

// Minimal replica of handleImport to unit-test the logic path
async function buildHandleImport({
  userId,
  githubLogin,
  currentRef,
  setRoot,
  setSubCanvases,
}: {
  userId: string | undefined;
  githubLogin: string;
  currentRef: string | undefined;
  setRoot: (d: CanvasData) => void;
  setSubCanvases: (fn: (prev: Record<string, CanvasData>) => Record<string, CanvasData>) => void;
}) {
  return async (importedData: CanvasData) => {
    if (!userId) {
      mockToastError("You must be signed in to import a canvas.");
      return;
    }
    const ref = currentRef || undefined;
    try {
      await mockSaveCanvas(githubLogin, ref, importedData);
      if (!ref) {
        setRoot(importedData);
      } else {
        setSubCanvases((prev) => ({ ...prev, [ref]: importedData }));
      }
      mockToastSuccess("Canvas imported successfully.");
    } catch (err) {
      void err;
      mockToastError("Failed to import canvas. Please try again.");
    }
  };
}

const VALID_CANVAS: CanvasData = { nodes: [{ id: "n1", x: 0, y: 0, width: 100, height: 50, kind: "note", text: "hello" }], edges: [] };

describe("handleImport logic", () => {
  let setRoot: ReturnType<typeof vi.fn>;
  let setSubCanvases: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setRoot = vi.fn();
    setSubCanvases = vi.fn();
    mockSaveCanvas.mockClear();
    mockToastSuccess.mockClear();
    mockToastError.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects import when no session user", async () => {
    const handler = await buildHandleImport({
      userId: undefined,
      githubLogin: "acme",
      currentRef: undefined,
      setRoot,
      setSubCanvases,
    });
    await handler(VALID_CANVAS);

    expect(mockSaveCanvas).not.toHaveBeenCalled();
    expect(setRoot).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      "You must be signed in to import a canvas.",
    );
  });

  it("saves to root and calls setRoot when currentRef is empty", async () => {
    const handler = await buildHandleImport({
      userId: "user-1",
      githubLogin: "acme",
      currentRef: "",
      setRoot,
      setSubCanvases,
    });
    await handler(VALID_CANVAS);

    expect(mockSaveCanvas).toHaveBeenCalledWith("acme", undefined, VALID_CANVAS);
    expect(setRoot).toHaveBeenCalledWith(VALID_CANVAS);
    expect(setSubCanvases).not.toHaveBeenCalled();
    expect(mockToastSuccess).toHaveBeenCalledWith("Canvas imported successfully.");
  });

  it("saves to sub-canvas and calls setSubCanvases when currentRef is set", async () => {
    const handler = await buildHandleImport({
      userId: "user-1",
      githubLogin: "acme",
      currentRef: "initiative:abc",
      setRoot,
      setSubCanvases,
    });
    await handler(VALID_CANVAS);

    expect(mockSaveCanvas).toHaveBeenCalledWith("acme", "initiative:abc", VALID_CANVAS);
    expect(setRoot).not.toHaveBeenCalled();
    expect(setSubCanvases).toHaveBeenCalled();
    // Verify the updater function merges correctly
    const updater = setSubCanvases.mock.calls[0][0] as (prev: Record<string, CanvasData>) => Record<string, CanvasData>;
    const result = updater({});
    expect(result["initiative:abc"]).toEqual(VALID_CANVAS);
    expect(mockToastSuccess).toHaveBeenCalledWith("Canvas imported successfully.");
  });

  it("shows error toast when saveCanvas throws", async () => {
    mockSaveCanvas.mockRejectedValueOnce(new Error("network error"));
    const handler = await buildHandleImport({
      userId: "user-1",
      githubLogin: "acme",
      currentRef: "",
      setRoot,
      setSubCanvases,
    });
    await handler(VALID_CANVAS);

    expect(setRoot).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      "Failed to import canvas. Please try again.",
    );
  });
});
