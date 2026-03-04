import React from "react";
import { render, act, fireEvent, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { FeatureWhiteboardSection } from "@/components/features/FeatureWhiteboardSection";

// ─── Mock: Excalidraw (dynamic import stub) ────────────────────────────────────
// Calls the excalidrawAPI setter synchronously so excalidrawAPIRef.current is
// populated before effects run, and stores onChange so tests can fire it.

const mockExcalidrawAPI = {
  getSceneElements: vi.fn(),
  getAppState: vi.fn(),
  getFiles: vi.fn(),
  updateScene: vi.fn(),
  scrollToContent: vi.fn(),
};

// Module-level ref so every test can access the latest onChange
let capturedOnChange: ((...args: any[]) => void) | null = null;

vi.mock("next/dynamic", () => ({
  default: () =>
    function ExcalidrawStub({ onChange, excalidrawAPI: apiSetter }: any) {
      capturedOnChange = onChange ?? null;
      if (typeof apiSetter === "function") {
        // Must be called synchronously during render (before effects) so that
        // excalidrawAPIRef.current is set when the pointerup useEffect fires.
        apiSetter(mockExcalidrawAPI);
      }
      return React.createElement("div", { "data-testid": "excalidraw-stub" });
    },
}));

vi.mock("@excalidraw/excalidraw/index.css", () => ({}));

vi.mock("@/services/excalidraw-layout", () => ({
  extractParsedDiagram: vi.fn(() => null),
  relayoutDiagram: vi.fn(),
}));

vi.mock("@/lib/excalidraw-config", () => ({
  getInitialAppState: vi.fn((s: unknown) => s ?? {}),
}));

// ─── Mock: hooks ──────────────────────────────────────────────────────────────

const mockBroadcastElements = vi.fn();
const mockBroadcastCursor = vi.fn();
const SENDER_ID = "sender-abc";

vi.mock("@/hooks/useWhiteboardCollaboration", () => ({
  useWhiteboardCollaboration: () => ({
    collaborators: [],
    excalidrawCollaborators: new Map(),
    isConnected: true,
    broadcastElements: mockBroadcastElements,
    broadcastCursor: mockBroadcastCursor,
    senderId: SENDER_ID,
  }),
}));

let mockDiagramRunStatus: string | null = null;
const mockStopRun = vi.fn();
const mockRefetchDiagramRun = vi.fn();

vi.mock("@/hooks/useStakworkGeneration", () => ({
  useStakworkGeneration: () => ({
    latestRun: mockDiagramRunStatus ? { status: mockDiagramRunStatus, id: "run-1" } : null,
    stopRun: mockStopRun,
    isStopping: false,
    refetch: mockRefetchDiagramRun,
  }),
}));

// ─── Mock: UI components (lightweight stubs) ──────────────────────────────────

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: any) =>
    React.createElement("button", { onClick, disabled }, children),
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) =>
    React.createElement("div", { className }, children),
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: any) => React.createElement("label", null, children),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => React.createElement("div", null, children),
  SelectTrigger: ({ children }: any) => React.createElement("div", null, children),
  SelectValue: () => React.createElement("span"),
  SelectContent: ({ children }: any) => React.createElement("div", null, children),
  SelectItem: ({ children, value }: any) =>
    React.createElement("div", { "data-value": value }, children),
}));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) =>
    React.createElement(React.Fragment, null, children),
  Tooltip: ({ children }: any) =>
    React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: any) =>
    React.createElement(React.Fragment, null, children),
  TooltipContent: ({ children }: any) => React.createElement("div", null, children),
}));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/whiteboard/CollaboratorAvatars", () => ({
  CollaboratorAvatars: () => null,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ─── Test fixtures ────────────────────────────────────────────────────────────

const WHITEBOARD_ID = "wb-test-1";
const FEATURE_ID = "feat-test-1";
const WORKSPACE_ID = "ws-test-1";

const mockElements = [{ id: "el-1", type: "rectangle" }] as any;
const mockAppState = { viewBackgroundColor: "#ffffff", gridSize: null } as any;
const mockFiles = { "file-1": { id: "f1" } } as any;

const mockWhiteboardPayload = {
  success: true,
  data: {
    id: WHITEBOARD_ID,
    name: "Test Board",
    elements: [],
    appState: {},
    files: {},
    version: 5,
    featureId: FEATURE_ID,
  },
};

function jsonResponse(body: object, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function buildDefaultFetch(overrides?: { patchStatus?: number; patchBody?: object }) {
  const { patchStatus = 200, patchBody } = overrides ?? {};
  return vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
    const method = opts?.method ?? "GET";
    if (method === "GET" || !opts?.method) {
      if (typeof url === "string" && url.includes("workspaceId")) {
        return jsonResponse({ success: true, data: [] });
      }
      return jsonResponse(mockWhiteboardPayload);
    }
    if (method === "PATCH") {
      if (patchStatus !== 200) {
        return jsonResponse(patchBody ?? { generating: true }, patchStatus);
      }
      return jsonResponse({
        success: true,
        data: { ...mockWhiteboardPayload.data, version: 6 },
      });
    }
    return jsonResponse({});
  });
}

function renderComponent(
  props: Partial<React.ComponentProps<typeof FeatureWhiteboardSection>> = {}
) {
  return render(
    React.createElement(FeatureWhiteboardSection, {
      featureId: FEATURE_ID,
      workspaceId: WORKSPACE_ID,
      hasArchitecture: false,
      ...props,
    })
  );
}

async function waitForLoad() {
  // Two microtask flushes cover the two sequential fetches on mount
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// Fire onChange twice so that:
//  - call 1: isInitialLoadRef transitions true→false (skipped)
//  - call 2: pendingElementsRef is populated
function simulateChange() {
  if (!capturedOnChange) return;
  act(() => { capturedOnChange!(mockElements, mockAppState, mockFiles); });
  act(() => { capturedOnChange!(mockElements, mockAppState, mockFiles); });
}

// Find the div that has the containerRef (the one wrapping the Card/Excalidraw canvas).
// It is the second child of the root div (after the header row).
function getContainerDiv(container: HTMLElement): HTMLElement {
  // Structure: <div.space-y-2> → [header row div, container div]
  const root = container.firstChild as HTMLElement;
  // containerRef is on the div that holds the Card / Excalidraw
  // It's the last direct child of the root (after the flex header)
  const children = Array.from(root.children) as HTMLElement[];
  // Return the last child which is the containerRef div
  return children[children.length - 1];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FeatureWhiteboardSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    capturedOnChange = null;
    mockDiagramRunStatus = null;

    mockExcalidrawAPI.getSceneElements.mockReturnValue(mockElements);
    mockExcalidrawAPI.getAppState.mockReturnValue(mockAppState);
    mockExcalidrawAPI.getFiles.mockReturnValue(mockFiles);

    // Install a no-op global fetch between tests to absorb any leaked keepalive
    // calls from previous test unmounts (e.g. keepalive on unmount) before a test
    // sets its own fetchMock.
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } })
    );
  });

  afterEach(() => {
    // Always restore real timers so the next beforeEach starts from a clean state
    vi.useRealTimers();
  });

  // ── 1. expectedVersion in every PATCH body ────────────────────────────────

  describe("saveToDatabase – expectedVersion", () => {
    it("includes expectedVersion matching the loaded whiteboard version", async () => {
      const fetchMock = buildDefaultFetch();
      global.fetch = fetchMock;

      const { container } = renderComponent();
      await waitForLoad();

      // Trigger the pointerup-based save on the containerRef element
      const containerDiv = getContainerDiv(container);
      fireEvent.pointerUp(containerDiv);

      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });

      const patchCall = fetchMock.mock.calls.find(
        ([url, opts]: any[]) =>
          typeof url === "string" &&
          url.includes(WHITEBOARD_ID) &&
          opts?.method === "PATCH"
      );

      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall![1].body as string);
      expect(body).toHaveProperty("expectedVersion");
      expect(body.expectedVersion).toBe(5); // loaded version from mock
    });

    it("updates expectedVersion to the server-returned version after a successful save", async () => {
      const fetchMock = buildDefaultFetch(); // PATCH returns version 6
      global.fetch = fetchMock;

      const { container } = renderComponent();
      await waitForLoad();

      const containerDiv = getContainerDiv(container);

      // First save
      fireEvent.pointerUp(containerDiv);
      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });

      // Second save — should carry the updated version (6)
      fireEvent.pointerUp(containerDiv);
      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });

      const patchCalls = fetchMock.mock.calls.filter(
        ([url, opts]: any[]) =>
          typeof url === "string" &&
          url.includes(WHITEBOARD_ID) &&
          opts?.method === "PATCH"
      );

      expect(patchCalls.length).toBe(2);
      const secondBody = JSON.parse(patchCalls[1][1].body as string);
      expect(secondBody.expectedVersion).toBe(6);
    });
  });

  // ── 2. 409 stale → reload whiteboard, no retry ────────────────────────────

  describe("409 stale – reload", () => {
    it("calls loadWhiteboard after a stale 409 and does NOT re-call saveToDatabase", async () => {
      let patchCount = 0;
      let getCount = 0;

      const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (method === "GET" || !opts?.method) {
          getCount++;
          if (typeof url === "string" && url.includes("workspaceId")) {
            return jsonResponse({ success: true, data: [] });
          }
          return jsonResponse(mockWhiteboardPayload);
        }
        if (method === "PATCH") {
          patchCount++;
          return jsonResponse({ error: "Version conflict", stale: true }, 409);
        }
        return jsonResponse({});
      });

      global.fetch = fetchMock;

      const { container } = renderComponent();
      await waitForLoad();

      const getCountAfterLoad = getCount;
      const containerDiv = getContainerDiv(container);

      fireEvent.pointerUp(containerDiv);
      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
        await Promise.resolve();
      });

      // Exactly one PATCH
      expect(patchCount).toBe(1);
      // A reload GET fired after the stale 409
      expect(getCount).toBeGreaterThan(getCountAfterLoad);
      // No second PATCH (save was not retried)
      expect(patchCount).toBe(1);
    });
  });

  // ── 3. 409 generating → queue → retry after generation done ──────────────

  describe("409 generating – retry queue", () => {
    it("retries the pending save after diagramRun transitions to COMPLETED", async () => {
      // This test intentionally avoids act(async) + fake timer advancement combos
      // that cause React 19 to hang waiting for pending scheduled work.
      //
      // Strategy:
      //  1. Populate pendingSaveAfterGenerationRef by calling saveToDatabase directly
      //     via a pointerup (fake timer, sync act for advancement).
      //  2. Switch to real timers BEFORE the rerender so that the COMPLETED async IIFE
      //     resolves naturally (no fake timers blocking microtasks).
      //  3. Use waitFor to wait for the retry PATCH.

      let patchCount = 0;

      const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (method === "GET" || !opts?.method) {
          if (typeof url === "string" && url.includes("workspaceId")) {
            return jsonResponse({ success: true, data: [] });
          }
          return jsonResponse(mockWhiteboardPayload);
        }
        if (method === "PATCH") {
          patchCount++;
          if (patchCount === 1) {
            return jsonResponse({ generating: true }, 409);
          }
          return jsonResponse({
            success: true,
            data: { ...mockWhiteboardPayload.data, version: 7 },
          });
        }
        return jsonResponse({});
      });

      global.fetch = fetchMock;

      const { container, rerender } = renderComponent({ hasArchitecture: true });
      await waitForLoad();

      const containerDiv = getContainerDiv(container);
      fireEvent.pointerUp(containerDiv);

      // Advance fake timer synchronously (no async act) to fire the debounce
      act(() => { vi.advanceTimersByTime(600); });

      // Drain the fetch + 409 response microtasks with sync-only approach
      // Repeat enough times to flush the fetch promise chain
      for (let i = 0; i < 5; i++) {
        await act(async () => { await Promise.resolve(); });
      }

      expect(patchCount).toBe(1); // first save received 409 generating

      // Switch to real timers before triggering the COMPLETED path so that
      // the async IIFE resolves without fake timer interference.
      vi.useRealTimers();

      mockDiagramRunStatus = "COMPLETED";
      rerender(
        React.createElement(FeatureWhiteboardSection, {
          featureId: FEATURE_ID,
          workspaceId: WORKSPACE_ID,
          hasArchitecture: true,
        })
      );

      // Wait for the retry PATCH (reload fetch → finally → saveToDatabase)
      await waitFor(() => expect(patchCount).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    });

    it("retries the pending save after diagramRun transitions to FAILED/HALTED", async () => {
      let patchCount = 0;

      const fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const method = opts?.method ?? "GET";
        if (method === "GET" || !opts?.method) {
          if (typeof url === "string" && url.includes("workspaceId")) {
            return jsonResponse({ success: true, data: [] });
          }
          return jsonResponse(mockWhiteboardPayload);
        }
        if (method === "PATCH") {
          patchCount++;
          if (patchCount === 1) {
            return jsonResponse({ generating: true }, 409);
          }
          return jsonResponse({
            success: true,
            data: { ...mockWhiteboardPayload.data, version: 7 },
          });
        }
        return jsonResponse({});
      });

      global.fetch = fetchMock;

      const { container, rerender } = renderComponent({ hasArchitecture: true });
      await waitForLoad();

      const containerDiv = getContainerDiv(container);
      fireEvent.pointerUp(containerDiv);
      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(patchCount).toBe(1);

      // Generation fails
      mockDiagramRunStatus = "FAILED";
      rerender(
        React.createElement(FeatureWhiteboardSection, {
          featureId: FEATURE_ID,
          workspaceId: WORKSPACE_ID,
          hasArchitecture: true,
        })
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(patchCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 4. pointerup → 500ms debounced save ──────────────────────────────────

  describe("pointerup – 500ms debounced save", () => {
    it("does NOT fire a non-keepalive PATCH before the 500ms debounce elapses", async () => {
      const fetchMock = buildDefaultFetch();
      global.fetch = fetchMock;

      const { container } = renderComponent();
      await waitForLoad();

      const containerDiv = getContainerDiv(container);
      fireEvent.pointerUp(containerDiv);

      await act(async () => {
        vi.advanceTimersByTime(400);
        await Promise.resolve();
      });

      // Only count non-keepalive PATCHes (keepalive ones come from unmount flush
      // and are not triggered by the pointerup debounce)
      const patches = fetchMock.mock.calls.filter(
        ([url, opts]: any[]) =>
          typeof url === "string" &&
          url.includes(WHITEBOARD_ID) &&
          opts?.method === "PATCH" &&
          !opts?.keepalive
      );
      expect(patches).toHaveLength(0);
    });

    it("fires exactly one PATCH after the 500ms debounce", async () => {
      const fetchMock = buildDefaultFetch();
      global.fetch = fetchMock;

      const { container } = renderComponent();
      await waitForLoad();

      const containerDiv = getContainerDiv(container);
      fireEvent.pointerUp(containerDiv);

      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });

      const patches = fetchMock.mock.calls.filter(
        ([url, opts]: any[]) =>
          typeof url === "string" &&
          url.includes(WHITEBOARD_ID) &&
          opts?.method === "PATCH"
      );
      expect(patches).toHaveLength(1);
    });

    it("coalesces rapid pointerup events into a single PATCH", async () => {
      const fetchMock = buildDefaultFetch();
      global.fetch = fetchMock;

      const { container } = renderComponent();
      await waitForLoad();

      const el = getContainerDiv(container);

      fireEvent.pointerUp(el);
      await act(async () => { vi.advanceTimersByTime(100); });
      fireEvent.pointerUp(el);
      await act(async () => { vi.advanceTimersByTime(100); });
      fireEvent.pointerUp(el);

      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });

      const patches = fetchMock.mock.calls.filter(
        ([url, opts]: any[]) =>
          typeof url === "string" &&
          url.includes(WHITEBOARD_ID) &&
          opts?.method === "PATCH"
      );
      expect(patches).toHaveLength(1);
    });
  });

  // ── 5. Unmount keepalive flush ─────────────────────────────────────────────

  describe("unmount – keepalive flush", () => {
    it("fires a keepalive PATCH on unmount when pendingElementsRef has been populated", async () => {
      const fetchMock = buildDefaultFetch();
      global.fetch = fetchMock;

      const { unmount } = renderComponent();
      await waitForLoad();

      // Populate pendingElementsRef via onChange (two calls: skip initial, then store)
      simulateChange();

      const patchesBefore = fetchMock.mock.calls.filter(
        ([, opts]: any[]) => opts?.method === "PATCH"
      ).length;

      act(() => { unmount(); });
      await act(async () => { await Promise.resolve(); });

      const keepaliveCall = fetchMock.mock.calls.find(
        ([url, opts]: any[]) =>
          typeof url === "string" &&
          url.includes(WHITEBOARD_ID) &&
          opts?.method === "PATCH" &&
          opts?.keepalive === true
      );

      expect(keepaliveCall).toBeDefined();

      const body = JSON.parse(keepaliveCall![1].body as string);
      expect(body).toHaveProperty("expectedVersion");
      expect(body.broadcast).toBe(false);
      expect(body.elements).toBeDefined();

      const patchesAfter = fetchMock.mock.calls.filter(
        ([, opts]: any[]) => opts?.method === "PATCH"
      ).length;
      expect(patchesAfter).toBe(patchesBefore + 1);
    });

    it("does NOT fire a keepalive PATCH when no changes were made before unmount", async () => {
      const fetchMock = buildDefaultFetch();
      global.fetch = fetchMock;

      const { unmount } = renderComponent();
      await waitForLoad();

      // No onChange fired — pendingElementsRef stays null

      act(() => { unmount(); });
      await act(async () => { await Promise.resolve(); });

      const keepaliveCalls = fetchMock.mock.calls.filter(
        ([, opts]: any[]) => opts?.keepalive === true
      );
      expect(keepaliveCalls).toHaveLength(0);
    });
  });
});
