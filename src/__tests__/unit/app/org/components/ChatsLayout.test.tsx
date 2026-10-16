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
const dragHandlers = vi.hoisted(() => [] as Array<(dragging: boolean) => void>);
const panels = vi.hoisted(
  () => ({}) as Record<string, { collapse: ReturnType<typeof vi.fn>; expand: ReturnType<typeof vi.fn>; collapsed: boolean; onCollapse?: () => void }>,
);

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
  ResizablePanel: React.forwardRef(function MockPanel(
    {
      id,
      children,
      onCollapse,
      onTransitionEnd,
    }: {
      id: string;
      children?: React.ReactNode;
      onCollapse?: () => void;
      onTransitionEnd?: React.TransitionEventHandler;
    },
    ref: React.Ref<unknown>,
  ) {
    const p = (panels[id] ??= {
      collapse: vi.fn(() => {
        panels[id].collapsed = true;
      }),
      expand: vi.fn(() => {
        panels[id].collapsed = false;
      }),
      collapsed: false,
    });
    p.onCollapse = onCollapse;
    React.useImperativeHandle(ref, () => ({
      collapse: p.collapse,
      expand: p.expand,
      isCollapsed: () => p.collapsed,
    }));
    return (
      <div data-panel-id={id} onTransitionEnd={onTransitionEnd}>
        {children}
      </div>
    );
  }),
  ResizableHandle: ({ onDragging }: { onDragging?: (dragging: boolean) => void }) => {
    if (onDragging) dragHandlers.push(onDragging);
    return null;
  },
  RESIZABLE_PANEL_TRANSITION: "",
}));
vi.mock("@/app/org/[githubLogin]/_components/control-panel/useControlPanel", () => ({ useControlPanel: () => ({}) }));
vi.mock("@/app/org/[githubLogin]/_components/control-panel/ControlPanelList", () => ({ ControlPanelList: () => null }));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/ArtifactPanel", () => ({ ArtifactPanel: () => <p>artifact-content</p> }));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({
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
    closeArtifactPanel.mockReset();
    dragHandlers.length = 0;
    for (const k of Object.keys(panels)) delete panels[k];
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

  const layout = () => <ChatsLayout githubLogin="acme" renderChat={() => <p>chat</p>} />;

  test("the artifact panel is rendered whether or not an artifact is open", () => {
    const { container, rerender } = render(layout());
    expect(container.querySelector('[data-panel-id="org-chats-artifact"]')).not.toBeNull();
    mockArtifactOpen = true;
    rerender(layout());
    expect(container.querySelector('[data-panel-id="org-chats-artifact"]')).not.toBeNull();
  });

  test("open/close collapses and expands the artifact panel only", () => {
    const { rerender } = render(layout());
    expect(panels["org-chats-artifact"].collapse).toHaveBeenCalledTimes(1);
    mockArtifactOpen = true;
    rerender(layout());
    expect(panels["org-chats-artifact"].expand).toHaveBeenCalledTimes(1);
    mockArtifactOpen = false;
    rerender(layout());
    expect(panels["org-chats-artifact"].collapse).toHaveBeenCalledTimes(2);
    expect(panels["org-chats-list"].collapse).not.toHaveBeenCalled();
    expect(panels["org-chats-list"].expand).not.toHaveBeenCalled();
  });

  test("artifact content renders while open, stays up while the pane eases shut, then unmounts", () => {
    const { container, rerender } = render(layout());
    expect(screen.queryByText("artifact-content")).toBeNull();
    mockArtifactOpen = true;
    rerender(layout());
    expect(screen.getByText("artifact-content")).toBeTruthy();
    mockArtifactOpen = false;
    rerender(layout());
    expect(screen.getByText("artifact-content")).toBeTruthy();
    fireEvent.transitionEnd(container.querySelector('[data-panel-id="org-chats-artifact"]')!);
    expect(screen.queryByText("artifact-content")).toBeNull();
  });

  test("a collapse the group reports without a drag does not close the open artifact", () => {
    mockArtifactOpen = true;
    render(layout());
    panels["org-chats-artifact"].onCollapse?.();
    expect(closeArtifactPanel).not.toHaveBeenCalled();
  });

  test("dragging the artifact divider shut closes the open artifact", () => {
    mockArtifactOpen = true;
    render(layout());
    dragHandlers.at(-1)?.(true);
    panels["org-chats-artifact"].onCollapse?.();
    expect(closeArtifactPanel).toHaveBeenCalledTimes(1);
  });
});
