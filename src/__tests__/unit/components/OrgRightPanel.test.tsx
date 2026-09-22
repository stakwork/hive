// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CanvasNode, CanvasEdge } from "system-canvas";
import type { ConnectionData } from "@/app/org/[githubLogin]/connections/types";

const mockUseIsMobile = vi.fn(() => false);

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

vi.mock("@/app/org/[githubLogin]/_state/useAutomationInbox", () => ({
  useAutomationInbox: () => ({
    count: 2,
    runs: [
      {
        automationId: "auto-1",
        automationName: "Nightly recap",
        conversationId: "conv-1",
        lastRunAt: new Date().toISOString(),
      },
    ],
    openRun: vi.fn(),
  }),
}));

vi.mock("@/app/org/[githubLogin]/_components/SidebarChat", () => ({
  SidebarChat: () => <div data-testid="sidebar-chat">chat</div>,
  SidebarChatActions: ({ compact }: { compact?: boolean }) => (
    <div data-testid="sidebar-chat-actions" data-compact={compact ? "true" : "false"}>
      <button aria-label="Conversation history">History</button>
      <button aria-label="New chat">New chat</button>
      {!compact && (
        <>
          <button aria-label="Copy share link">Share</button>
          <button aria-label="Fork chat">Fork</button>
          <button aria-label="Agent settings">Settings</button>
        </>
      )}
    </div>
  ),
}));

vi.mock("@/app/org/[githubLogin]/_components/NodeDetail", () => ({
  NodeDetail: () => <div data-testid="node-detail">details</div>,
}));

vi.mock("@/app/org/[githubLogin]/_components/MultiNodeDetail", () => ({
  MultiNodeDetail: () => <div data-testid="multi-node-detail">multi</div>,
}));

vi.mock("@/app/org/[githubLogin]/_components/ConnectionsListBody", () => ({
  ConnectionsListBody: () => <div data-testid="connections-list">connections</div>,
}));

vi.mock("@/app/org/[githubLogin]/connections/ConnectionViewer", () => ({
  ConnectionViewer: () => <div data-testid="connection-viewer">viewer</div>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { OrgRightPanel } from "@/app/org/[githubLogin]/_components/OrgRightPanel";

const NODE: CanvasNode = {
  id: "feature:1",
  text: "Ship it",
  category: "feature",
  type: "text",
  x: 0,
  y: 0,
  width: 220,
  height: 80,
} as CanvasNode;

const CONNECTION: ConnectionData = {
  id: "conn-1",
  slug: "payments",
  name: "Payments",
  summary: "",
  diagram: null,
  architecture: null,
  openApiSpec: null,
  createdAt: "",
  updatedAt: "",
};

const EDGE: CanvasEdge = {
  id: "edge-1",
  fromNode: "a",
  toNode: "b",
} as unknown as CanvasEdge;

const noop = () => {};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof OrgRightPanel>> = {},
) {
  return render(
    <OrgRightPanel
      githubLogin="acme"
      selectedNode={null}
      selectedNodes={[]}
      selectedNodesInternalEdges={[]}
      chatReady
      connections={[CONNECTION]}
      activeConnection={null}
      onConnectionClick={noop}
      onConnectionClose={noop}
      onConnectionCreated={noop}
      onConnectionDeleted={noop}
      isLoading={false}
      selectedEdge={null}
      onLinkConnectionToEdge={noop}
      onUnlinkConnectionFromEdge={noop}
      onCreateConnectionForEdge={noop}
      linkedConnectionIds={new Set()}
      onOpenControlPanel={noop}
      {...overrides}
    />,
  );
}

describe("OrgRightPanel", () => {
  beforeEach(() => {
    mockUseIsMobile.mockReturnValue(false);
  });

  describe("desktop", () => {
    it("auto-flips to Details when a node is selected", () => {
      renderPanel({ selectedNode: NODE });
      expect(screen.getByTestId("node-detail").closest("[hidden]")).toBeNull();
      expect(screen.getByTestId("sidebar-chat").closest("[hidden]")).toBeTruthy();
    });

    it("auto-flips to Connections when a connection is open", () => {
      renderPanel({ activeConnection: CONNECTION });
      expect(screen.getByTestId("connection-viewer").closest("[hidden]")).toBeNull();
      expect(screen.getByTestId("sidebar-chat").closest("[hidden]")).toBeTruthy();
    });

    it("auto-flips to Connections when an edge is selected", () => {
      renderPanel({
        selectedEdge: { edge: EDGE, canvasRef: undefined, fromLabel: "A", toLabel: "B" },
      });
      expect(screen.getByTestId("connections-list").closest("[hidden]")).toBeNull();
      expect(screen.getByTestId("sidebar-chat").closest("[hidden]")).toBeTruthy();
    });

    it("shows Details, Connections, inbox, control-panel toggle, and full actions", () => {
      renderPanel();
      expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Connections/ })).toBeInTheDocument();
      expect(screen.getByLabelText(/unseen automation run/)).toBeInTheDocument();
      expect(screen.getByLabelText("Control panel")).toBeInTheDocument();
      expect(screen.getByTestId("sidebar-chat-actions")).toHaveAttribute("data-compact", "false");
      expect(screen.getByLabelText("Copy share link")).toBeInTheDocument();
      expect(screen.getByLabelText("Fork chat")).toBeInTheDocument();
    });
  });

  describe("mobile", () => {
    beforeEach(() => {
      mockUseIsMobile.mockReturnValue(true);
    });

    it("stays on Chat even when a node, connection, or edge is selected", () => {
      const { rerender } = renderPanel({ selectedNode: NODE });
      expect(screen.getByTestId("sidebar-chat").closest("[hidden]")).toBeNull();
      expect(screen.getByTestId("node-detail").closest("[hidden]")).toBeTruthy();

      rerender(
        <OrgRightPanel
          githubLogin="acme"
          selectedNode={null}
          selectedNodes={[]}
          selectedNodesInternalEdges={[]}
          chatReady
          connections={[CONNECTION]}
          activeConnection={CONNECTION}
          onConnectionClick={noop}
          onConnectionClose={noop}
          onConnectionCreated={noop}
          onConnectionDeleted={noop}
          isLoading={false}
          selectedEdge={{ edge: EDGE, canvasRef: undefined, fromLabel: "A", toLabel: "B" }}
          onLinkConnectionToEdge={noop}
          onUnlinkConnectionFromEdge={noop}
          onCreateConnectionForEdge={noop}
          linkedConnectionIds={new Set()}
          onOpenControlPanel={noop}
        />,
      );
      expect(screen.getByTestId("sidebar-chat").closest("[hidden]")).toBeNull();
    });

    it("hides Details, Connections, inbox, and the control-panel toggle", () => {
      renderPanel({ selectedNode: NODE });
      expect(screen.getByRole("button", { name: "Details" }).className).toContain("hidden");
      expect(screen.getByRole("button", { name: /Connections/ }).className).toContain("hidden");
      expect(screen.getByLabelText(/unseen automation run/).className).toContain("hidden");
      expect(screen.getByLabelText("Control panel").className).toContain("hidden");
      expect(screen.getByTestId("sidebar-chat")).toBeInTheDocument();
    });

    it("renders compact chat actions", () => {
      renderPanel();
      expect(screen.getByTestId("sidebar-chat-actions")).toHaveAttribute("data-compact", "true");
      expect(screen.getByLabelText("Conversation history")).toBeInTheDocument();
      expect(screen.getByLabelText("New chat")).toBeInTheDocument();
      expect(screen.queryByLabelText("Copy share link")).toBeNull();
      expect(screen.queryByLabelText("Fork chat")).toBeNull();
      expect(screen.queryByLabelText("Agent settings")).toBeNull();
    });
  });
});
