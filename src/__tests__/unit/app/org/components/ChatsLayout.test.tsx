// @vitest-environment jsdom
/**
 * The chats view has no canvas: a canvas-only param written into the URL
 * (an in-chat `?r=` link) or a canvas deeplink chip sends the page to the
 * canvas view, carrying the open chat.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

let mockSearch = "";
let mockDeeplink: { canvasRef: string } | null = null;
let mockArtifactOpen = false;
const closeArtifactPanel = vi.fn();
/** The artifact pane's imperative handle, as the panel library would expose it. */
const artifactHandle = {
  collapsed: true,
  expand: vi.fn(),
  collapse: vi.fn(),
  isCollapsed: () => artifactHandle.collapsed,
};
let artifactDragging: ((isDragging: boolean) => void) | undefined;

vi.mock("next/navigation", () => ({
  usePathname: () => "/org/acme",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: Object.assign(
    (select: (s: { pendingDeeplink: unknown }) => unknown) => select({ pendingDeeplink: mockDeeplink }),
    { getState: () => ({ closeArtifactPanel }) },
  ),
}));
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: React.forwardRef(function Panel(
    {
      id,
      children,
      onTransitionEnd,
    }: { id?: string; children: React.ReactNode; onTransitionEnd?: React.TransitionEventHandler },
    ref: React.Ref<unknown>,
  ) {
    React.useImperativeHandle(ref, () => (id === "org-chats-artifact" ? artifactHandle : {}));
    return (
      <div data-testid={id} onTransitionEnd={onTransitionEnd}>
        {children}
      </div>
    );
  }),
  ResizableHandle: ({ onDragging }: { onDragging?: (isDragging: boolean) => void }) => {
    if (onDragging) artifactDragging = onDragging;
    return null;
  },
  RESIZABLE_PANEL_TRANSITION: "",
}));
vi.mock("@/app/org/[githubLogin]/_components/control-panel/useControlPanel", () => ({ useControlPanel: () => ({}) }));
vi.mock("@/app/org/[githubLogin]/_components/control-panel/ControlPanelList", () => ({ ControlPanelList: () => null }));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/ArtifactPanel", () => ({
  ArtifactPanel: () => <p>artifact</p>,
}));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({
  ArtifactPanelSideContext: React.createContext("left"),
  useArtifactPanelOpen: () => mockArtifactOpen,
}));

import { ChatsLayout } from "@/app/org/[githubLogin]/_components/ChatsLayout";

describe("ChatsLayout", () => {
  const assign = vi.fn();
  beforeEach(() => {
    assign.mockReset();
    mockSearch = "chat=c1";
    mockDeeplink = null;
    mockArtifactOpen = false;
    artifactHandle.collapsed = true;
    vi.clearAllMocks();
    vi.stubGlobal("location", { ...window.location, assign });
  });
  afterEach(() => vi.unstubAllGlobals());

  const renderLayout = () => render(<ChatsLayout githubLogin="acme" renderChat={() => <p>chat</p>} />);

  test("stays put on a plain chats URL", () => {
    renderLayout();
    expect(assign).not.toHaveBeenCalled();
  });

  test("a canvas-only param goes to the canvas view with the chat", () => {
    mockSearch = "chat=c1&r=stripe-connect";
    renderLayout();
    expect(assign).toHaveBeenCalledWith("/org/acme?chat=c1&r=stripe-connect&view=canvas");
  });

  test("a canvas deeplink goes to the canvas view on the node's canvas", () => {
    mockDeeplink = { canvasRef: "initiative:xyz" };
    renderLayout();
    expect(assign).toHaveBeenCalledWith("/org/acme?chat=c1&view=canvas&canvas=initiative%3Axyz");
  });

  describe("artifact pane", () => {
    test("stays collapsed and empty while nothing is open", () => {
      renderLayout();
      expect(screen.queryByText("artifact")).toBeNull();
      expect(artifactHandle.expand).not.toHaveBeenCalled();
    });

    test("expands with the artifact when one opens", () => {
      const { rerender } = renderLayout();
      mockArtifactOpen = true;
      rerender(<ChatsLayout githubLogin="acme" renderChat={() => <p>chat</p>} />);
      expect(artifactHandle.expand).toHaveBeenCalled();
      expect(screen.getByText("artifact")).toBeTruthy();
    });

    test("keeps the artifact up while it eases shut, then unmounts it", () => {
      mockArtifactOpen = true;
      artifactHandle.collapsed = false;
      const { rerender } = renderLayout();
      mockArtifactOpen = false;
      rerender(<ChatsLayout githubLogin="acme" renderChat={() => <p>chat</p>} />);
      expect(artifactHandle.collapse).toHaveBeenCalled();
      expect(screen.getByText("artifact")).toBeTruthy();
      fireEvent.transitionEnd(screen.getByTestId("org-chats-artifact"));
      expect(screen.queryByText("artifact")).toBeNull();
    });

    test("dragged shut, the artifact closes", () => {
      mockArtifactOpen = true;
      artifactHandle.collapsed = false;
      renderLayout();
      artifactHandle.collapsed = true;
      artifactDragging?.(false);
      expect(closeArtifactPanel).toHaveBeenCalled();
    });
  });
});
