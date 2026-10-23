import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MobileChatScreen } from "@/app/org/[githubLogin]/_components/mobile/MobileChatScreen";
import { MobileOrgContext } from "@/app/org/[githubLogin]/_components/mobile/MobileOrgContext";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";

vi.mock("@/app/org/[githubLogin]/_components/SidebarChat", () => ({
  SidebarChat: () => <div data-testid="sidebar-chat" />,
  useChatShareFork: () => ({
    activeId: null,
    serverConversationId: "conv-1",
    isStreaming: false,
    isForking: false,
    isActive: false,
    handleShare: vi.fn(),
    handleFork: vi.fn(),
  }),
}));

vi.mock("@/app/org/[githubLogin]/_components/AgentSettingsMenu", () => ({
  AutomationsDialog: () => null,
}));

vi.mock("@/app/org/[githubLogin]/_components/artifacts/ArtifactPanel", () => ({
  ArtifactPanel: () => null,
  groupIndex: () => [],
}));

describe("MobileChatScreen", () => {
  beforeEach(() => {
    useCanvasChatStore.setState({ activeConversationId: null, conversations: {} });
  });

  it("renders the top bar with its menu, title, artifacts and new-chat buttons over the chat", () => {
    render(<MobileChatScreen githubLogin="acme" chatReady />);
    expect(screen.getByTestId("mobile-org-topbar")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-menu-button")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-chat-title")).toHaveTextContent("New chat");
    // No artifacts yet: like the desktop toggle, no button.
    expect(screen.queryByTestId("mobile-artifacts-button")).toBeNull();
    expect(screen.getByTestId("mobile-new-chat-button")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-chat")).toBeInTheDocument();
  });

  it("shows a spinner, not the chat, until the conversation is ready", () => {
    render(<MobileChatScreen githubLogin="acme" chatReady={false} />);
    expect(screen.queryByTestId("sidebar-chat")).toBeNull();
  });

  it("opens the chat's actions from the title", async () => {
    render(<MobileChatScreen githubLogin="acme" chatReady />);
    fireEvent.click(screen.getByTestId("mobile-chat-title"));
    expect(await screen.findByTestId("mobile-chat-actions-sheet")).toBeInTheDocument();
    expect(screen.getByText("Share link")).toBeInTheDocument();
    expect(screen.getByText("Fork into my copy")).toBeInTheDocument();
    expect(screen.queryByText("Concept-tree prompt")).toBeNull();
    expect(screen.queryByText("Strut orchestrator")).toBeNull();
    expect(screen.getByText("Automations")).toBeInTheDocument();
    // No list row for this chat in the test shell, so there is nothing to archive.
    expect(screen.getByRole("button", { name: /Archive chat/ })).toBeDisabled();
  });

  it("swaps the menu for a back button when opened over another screen", () => {
    const onBack = vi.fn();
    render(<MobileChatScreen githubLogin="acme" chatReady onBack={onBack} />);
    expect(screen.queryByTestId("mobile-menu-button")).toBeNull();
    fireEvent.click(screen.getByTestId("mobile-back-button"));
    expect(onBack).toHaveBeenCalled();
  });

  it("archives the chat from its actions and starts a new one", async () => {
    const onArchive = vi.fn();
    const item = { id: "conv-1", title: "Plan", jobs: [], pullRequests: [], working: false };
    const chatList = {
      groups: [{ key: "today", label: "Today", items: [item] }],
      onArchive,
    } as unknown as React.ComponentProps<typeof MobileOrgContext.Provider>["value"]["chatList"];
    render(
      <MobileOrgContext.Provider value={{ openDrawer: vi.fn(), chatList }}>
        <MobileChatScreen githubLogin="acme" chatReady />
      </MobileOrgContext.Provider>,
    );
    fireEvent.click(screen.getByTestId("mobile-chat-title"));
    fireEvent.click(await screen.findByRole("button", { name: /Archive chat/ }));
    expect(onArchive).toHaveBeenCalledWith(item);
  });
});
