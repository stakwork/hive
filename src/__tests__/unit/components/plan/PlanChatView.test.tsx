import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanChatView } from "@/app/w/[slug]/plan/[featureId]/components/PlanChatView";
import { ChatRole, ChatStatus } from "@/lib/chat";

// Mock dependencies
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "workspace-1", slug: "test-workspace" },
    workspaceId: "workspace-1",
  }),
}));

vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: vi.fn(),
}));

const mockUseDetailResource = vi.fn(() => ({
  data: null,
  setData: vi.fn(),
  loading: false,
  error: null,
}));

vi.mock("@/hooks/useDetailResource", () => ({
  useDetailResource: () => mockUseDetailResource(),
}));

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/usePlanPresence", () => ({
  usePlanPresence: () => ({
    collaborators: [],
  }),
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizablePanelGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

vi.mock("@/components/chat", () => ({
  ChatArea: ({ onArtifactAction }: { onArtifactAction: (messageId: string, action: { optionResponse: string }) => void }) => (
    <div data-testid="chat-area">
      <button
        data-testid="artifact-action-button"
        onClick={() => onArtifactAction("test-message-id", { optionResponse: "Test answer" })}
      >
        Submit Answer
      </button>
    </div>
  ),
  ArtifactsPanel: () => <div data-testid="artifacts-panel">Artifacts Panel</div>,
}));

describe("PlanChatView", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  it("should pass replyId when handleArtifactAction is called", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: {
            id: "new-message-id",
            message: "Test answer",
            role: ChatRole.USER,
            status: ChatStatus.SENT,
            replyId: "test-message-id",
            createdAt: new Date().toISOString(),
          },
        }),
      });

    render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-area")).toBeInTheDocument();
    });

    const submitButton = screen.getByTestId("artifact-action-button");
    await userEvent.click(submitButton);

    await waitFor(() => {
      const sendMessageCall = mockFetch.mock.calls.find(
        (call) => call[0] === "/api/features/feature-123/chat" && call[1]?.method === "POST"
      );

      expect(sendMessageCall).toBeDefined();
      const body = JSON.parse(sendMessageCall![1].body);
      expect(body).toEqual({
        message: "Test answer",
        replyId: "test-message-id",
      });
    });
  });

  it("should redirect to plan list when feature not found", async () => {
    // Mock useDetailResource to return error state
    mockUseDetailResource.mockReturnValueOnce({
      data: null,
      setData: vi.fn(),
      loading: false,
      error: "Not found",
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    render(<PlanChatView featureId="bad-id" workspaceSlug="test-workspace" workspaceId="ws-1" />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/plan");
    });
  });

  it("should refetch feature and messages when tab becomes visible", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-area")).toBeInTheDocument();
    });

    // Clear initial fetch calls
    mockFetch.mockClear();

    // Simulate tab becoming visible
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    const visibilityEvent = new Event('visibilitychange');
    document.dispatchEvent(visibilityEvent);

    await waitFor(() => {
      // Should refetch both feature data and messages
      expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123");
      expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123/chat");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  it("should not refetch when tab becomes hidden", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-area")).toBeInTheDocument();
    });

    // Clear initial fetch calls
    mockFetch.mockClear();

    // Simulate tab becoming hidden
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });

    const visibilityEvent = new Event('visibilitychange');
    document.dispatchEvent(visibilityEvent);

    // Wait a bit to ensure no fetch calls are made
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should cleanup visibility listener on unmount", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const { unmount } = render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-area")).toBeInTheDocument();
    });

    // Clear initial fetch calls
    mockFetch.mockClear();

    // Unmount the component
    unmount();

    // Simulate tab becoming visible after unmount
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    const visibilityEvent = new Event('visibilitychange');
    document.dispatchEvent(visibilityEvent);

    // Wait a bit to ensure no fetch calls are made
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
