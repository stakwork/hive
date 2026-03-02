import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatArea } from "@/app/w/[slug]/task/[...taskParams]/components/ChatArea";

// Create a mock function for useIsMobile
const mockUseIsMobile = vi.fn();

// Mock the hooks and components
vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ChatMessage", () => ({
  ChatMessage: () => <div>ChatMessage</div>,
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ChatInput", () => ({
  ChatInput: () => <div>ChatInput</div>,
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/TaskBreadcrumbs", () => ({
  default: () => <div>TaskBreadcrumbs</div>,
}));

vi.mock("@/components/whiteboard/CollaboratorAvatars", () => ({
  CollaboratorAvatars: () => <div>CollaboratorAvatars</div>,
}));

vi.mock("@/components/plan/InvitePopover", () => ({
  InvitePopover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("ChatArea - Mobile Header Sticky Behavior", () => {
  const defaultProps = {
    messages: [],
    onSend: vi.fn(),
    onArtifactAction: vi.fn(),
  };

  beforeEach(() => {
    mockUseIsMobile.mockReset();
  });

  it("should apply fixed top-0 classes to header and pt-16 to messages container when isMobile=true and taskTitle exists", () => {
    mockUseIsMobile.mockReturnValue(true);

    const { container } = render(
      <ChatArea {...defaultProps} taskTitle="Test Task Title" workspaceSlug="test-workspace" taskId="task-123" />
    );

    // Find the header div - it should have fixed top-0 classes
    const headerDiv = container.querySelector('[data-testid="task-title"]')?.closest(".px-4");
    expect(headerDiv).toBeTruthy();
    expect(headerDiv?.className).toContain("fixed");
    expect(headerDiv?.className).toContain("top-0");
    expect(headerDiv?.className).toContain("left-0");
    expect(headerDiv?.className).toContain("right-0");
    expect(headerDiv?.className).toContain("z-20");
    expect(headerDiv?.className).toContain("bg-background");

    // Find the messages container - it should have pt-16 class
    const messagesContainer = container.querySelector(".overflow-y-auto");
    expect(messagesContainer).toBeTruthy();
    expect(messagesContainer?.className).toContain("pb-28"); // Existing mobile padding
    expect(messagesContainer?.className).toContain("pt-16"); // New top padding for fixed header
  });

  it("should NOT apply fixed top-0 or pt-16 classes when isMobile=false (desktop)", () => {
    mockUseIsMobile.mockReturnValue(false);

    const { container } = render(
      <ChatArea {...defaultProps} taskTitle="Test Task Title" workspaceSlug="test-workspace" taskId="task-123" />
    );

    // Find the header div - it should NOT have fixed classes
    const headerDiv = container.querySelector('[data-testid="task-title"]')?.closest(".px-4");
    expect(headerDiv).toBeTruthy();
    expect(headerDiv?.className).not.toContain("fixed");
    expect(headerDiv?.className).not.toContain("top-0");
    expect(headerDiv?.className).not.toContain("z-20");

    // Find the messages container - it should NOT have pt-16 or pb-28
    const messagesContainer = container.querySelector(".overflow-y-auto");
    expect(messagesContainer).toBeTruthy();
    expect(messagesContainer?.className).not.toContain("pb-28");
    expect(messagesContainer?.className).not.toContain("pt-16");
  });

  it("should NOT render header or apply pt-16 when isMobile=true but taskTitle is null", () => {
    mockUseIsMobile.mockReturnValue(true);

    const { container } = render(<ChatArea {...defaultProps} taskTitle={null} />);

    // Header should not be rendered
    const headerDiv = container.querySelector('[data-testid="task-title"]');
    expect(headerDiv).toBeFalsy();

    // Messages container should have pb-28 but NOT pt-16
    const messagesContainer = container.querySelector(".overflow-y-auto");
    expect(messagesContainer).toBeTruthy();
    expect(messagesContainer?.className).toContain("pb-28"); // Still has bottom padding
    expect(messagesContainer?.className).not.toContain("pt-16"); // No top padding without header
  });

  it("should NOT render header or apply pt-16 when isMobile=true but taskTitle is undefined", () => {
    mockUseIsMobile.mockReturnValue(true);

    const { container } = render(<ChatArea {...defaultProps} taskTitle={undefined} />);

    // Header should not be rendered
    const headerDiv = container.querySelector('[data-testid="task-title"]');
    expect(headerDiv).toBeFalsy();

    // Messages container should have pb-28 but NOT pt-16
    const messagesContainer = container.querySelector(".overflow-y-auto");
    expect(messagesContainer).toBeTruthy();
    expect(messagesContainer?.className).toContain("pb-28");
    expect(messagesContainer?.className).not.toContain("pt-16");
  });
});
