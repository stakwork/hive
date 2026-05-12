import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLinkElement } from "@/services/whiteboard-elements";

/**
 * Unit tests for the handleInsertLink logic and onLinkOpen behaviour.
 * The whiteboard page is a heavy Next.js/Excalidraw component so we test
 * the extracted logic directly rather than rendering the full page.
 */

// ── helpers that mirror the handleInsertLink implementation ──────────────────

function buildHandleInsertLink({
  excalidrawAPI,
  containerRef,
  programmaticUpdateCountRef,
  saveToDatabase,
}: {
  excalidrawAPI: {
    getAppState: () => { scrollX: number; scrollY: number; zoom: { value: number } };
    getSceneElementsIncludingDeleted: () => unknown[];
    updateScene: (opts: { elements: unknown[] }) => void;
    getFiles: () => Record<string, unknown>;
  } | null;
  containerRef: { current: { clientWidth: number; clientHeight: number } | null };
  programmaticUpdateCountRef: { current: number };
  saveToDatabase: (
    elements: unknown[],
    appState: unknown,
    files: unknown
  ) => void;
}) {
  return (url: string, label: string) => {
    if (!excalidrawAPI || !containerRef.current) return;
    const { scrollX, scrollY, zoom } = excalidrawAPI.getAppState();
    const container = containerRef.current;
    const centerX = -scrollX + (container.clientWidth / 2) / zoom.value;
    const centerY = -scrollY + (container.clientHeight / 2) / zoom.value;
    const newElements = createLinkElement(url, label, centerX, centerY);
    programmaticUpdateCountRef.current++;
    const existing = excalidrawAPI.getSceneElementsIncludingDeleted();
    excalidrawAPI.updateScene({ elements: [...existing, ...newElements] });
    const appState = excalidrawAPI.getAppState();
    const files = excalidrawAPI.getFiles();
    saveToDatabase([...existing, ...newElements], appState, files);
  };
}

// ── onLinkOpen helper ────────────────────────────────────────────────────────

function buildOnLinkOpen(windowOpen: typeof window.open) {
  return (element: { link?: string }, event: { preventDefault: () => void }) => {
    event.preventDefault();
    const url = element.link;
    if (url) windowOpen(url, "_blank", "noopener,noreferrer");
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("handleInsertLink logic", () => {
  let excalidrawAPI: ReturnType<typeof buildHandleInsertLink> extends (
    ...args: unknown[]
  ) => unknown
    ? never
    : {
        getAppState: ReturnType<typeof vi.fn>;
        getSceneElementsIncludingDeleted: ReturnType<typeof vi.fn>;
        updateScene: ReturnType<typeof vi.fn>;
        getFiles: ReturnType<typeof vi.fn>;
      };
  let containerRef: { current: { clientWidth: number; clientHeight: number } };
  let programmaticUpdateCountRef: { current: number };
  let saveToDatabase: ReturnType<typeof vi.fn>;
  let handleInsertLink: ReturnType<typeof buildHandleInsertLink>;

  beforeEach(() => {
    excalidrawAPI = {
      getAppState: vi.fn().mockReturnValue({ scrollX: 0, scrollY: 0, zoom: { value: 1 } }),
      getSceneElementsIncludingDeleted: vi.fn().mockReturnValue([]),
      updateScene: vi.fn(),
      getFiles: vi.fn().mockReturnValue({}),
    };
    containerRef = { current: { clientWidth: 1000, clientHeight: 800 } };
    programmaticUpdateCountRef = { current: 0 };
    saveToDatabase = vi.fn();

    handleInsertLink = buildHandleInsertLink({
      excalidrawAPI,
      containerRef,
      programmaticUpdateCountRef,
      saveToDatabase,
    });
  });

  it("does nothing when excalidrawAPI is null", () => {
    const noop = buildHandleInsertLink({
      excalidrawAPI: null,
      containerRef,
      programmaticUpdateCountRef,
      saveToDatabase,
    });
    noop("https://example.com", "Label");
    expect(saveToDatabase).not.toHaveBeenCalled();
  });

  it("calls updateScene with elements including the new link element", () => {
    handleInsertLink("https://example.com", "Example");
    expect(excalidrawAPI.updateScene).toHaveBeenCalledOnce();
    const { elements } = excalidrawAPI.updateScene.mock.calls[0][0] as {
      elements: Record<string, unknown>[];
    };
    const rect = elements.find((el) => el.type === "rectangle");
    expect(rect).toBeDefined();
    expect(rect!.link).toBe("https://example.com");
  });

  it("increments programmaticUpdateCountRef", () => {
    handleInsertLink("https://example.com", "Example");
    expect(programmaticUpdateCountRef.current).toBe(1);
  });

  it("calls saveToDatabase with elements containing the link", () => {
    handleInsertLink("https://example.com", "Example");
    expect(saveToDatabase).toHaveBeenCalledOnce();
    const [elements] = saveToDatabase.mock.calls[0] as [Record<string, unknown>[]];
    const rect = elements.find((el) => el.type === "rectangle");
    expect(rect!.link).toBe("https://example.com");
  });

  it("centers the new element at the viewport center", () => {
    // scrollX=0, scrollY=0, zoom=1, container 1000x800 → center (500, 400)
    handleInsertLink("https://example.com", "Example");
    const { elements } = excalidrawAPI.updateScene.mock.calls[0][0] as {
      elements: Record<string, unknown>[];
    };
    const rect = elements.find((el) => el.type === "rectangle") as Record<string, number>;
    // rect.x = centerX - 120 = 500 - 120 = 380
    // rect.y = centerY - 32  = 400 - 32  = 368
    expect(rect.x).toBe(380);
    expect(rect.y).toBe(368);
  });
});

describe("onLinkOpen behaviour", () => {
  it("calls window.open with _blank and noopener,noreferrer", () => {
    const mockOpen = vi.fn();
    const onLinkOpen = buildOnLinkOpen(mockOpen);
    const event = { preventDefault: vi.fn() };
    onLinkOpen({ link: "https://example.com" }, event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockOpen).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer"
    );
  });

  it("does not call window.open when link is undefined", () => {
    const mockOpen = vi.fn();
    const onLinkOpen = buildOnLinkOpen(mockOpen);
    const event = { preventDefault: vi.fn() };
    onLinkOpen({}, event);
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
