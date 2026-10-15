// @vitest-environment jsdom
/**
 * The chats view has no canvas: a canvas-only param written into the URL
 * (an in-chat `?r=` link) or a canvas deeplink chip sends the page to the
 * canvas view, carrying the open chat.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "@testing-library/react";

let mockSearch = "";
let mockDeeplink: { canvasRef: string } | null = null;

vi.mock("next/navigation", () => ({
  usePathname: () => "/org/acme",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));
vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: (select: (s: { pendingDeeplink: unknown }) => unknown) =>
    select({ pendingDeeplink: mockDeeplink }),
}));
vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => null,
}));
vi.mock("@/app/org/[githubLogin]/_components/control-panel/useControlPanel", () => ({ useControlPanel: () => ({}) }));
vi.mock("@/app/org/[githubLogin]/_components/control-panel/ControlPanelList", () => ({ ControlPanelList: () => null }));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/ArtifactPanel", () => ({ ArtifactPanel: () => null }));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({
  ArtifactPanelSideContext: React.createContext("left"),
  useArtifactPanelOpen: () => false,
}));

import { ChatsLayout } from "@/app/org/[githubLogin]/_components/ChatsLayout";

describe("ChatsLayout", () => {
  const assign = vi.fn();
  beforeEach(() => {
    assign.mockReset();
    mockSearch = "chat=c1";
    mockDeeplink = null;
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
});
