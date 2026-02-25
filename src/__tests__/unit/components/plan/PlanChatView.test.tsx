import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanChatView } from "@/app/w/[slug]/plan/[featureId]/components/PlanChatView";
import { ChatRole, ChatStatus, WorkflowStatus } from "@/lib/chat";
import { usePusherConnection } from "@/hooks/usePusherConnection";

// Mock dependencies
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "workspace-1", slug: "test-workspace" },
    workspaceId: "workspace-1",
  }),
}));

vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: vi.fn(),
}));

vi.mock("@/hooks/useDetailResource", () => ({
  useDetailResource: () => ({
    data: null,
    setData: vi.fn(),
    isLoading: false,
    error: null,
  }),
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
  ChatArea: ({
    onArtifactAction,
    isLoading,
    workflowStatus,
  }: {
    onArtifactAction: (messageId: string, action: { optionResponse: string }) => void;
    isLoading: boolean;
    workflowStatus: WorkflowStatus | null;
  }) => (
    <div data-testid="chat-area">
      <div data-testid="chat-is-loading">{String(isLoading)}</div>
      <div data-testid="chat-workflow-status">{workflowStatus || "null"}</div>
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
  let latestPusherOptions: Record<string, unknown> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
    latestPusherOptions = null;
    vi.mocked(usePusherConnection).mockImplementation((options) => {
      latestPusherOptions = options as unknown as Record<string, unknown>;
      return {
        isConnected: true,
        connectionId: "pusher_feature_feature-123_1",
        connect: vi.fn(),
        disconnect: vi.fn(),
        error: null,
      };
    });
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
      expect(body.message).toBe("Test answer");
      expect(body.replyId).toBe("test-message-id");
    });
  });

  it("should refetch feature and messages when stale connection callback is fired", async () => {
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

    const onStaleConnection = latestPusherOptions?.onStaleConnection as (() => void) | undefined;
    onStaleConnection?.();

    await waitFor(() => {
      // Should refetch both feature data and messages
      expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123");
      expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123/chat");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  it("should not refetch when stale connection callback is not fired", async () => {
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

    // Wait a bit to ensure no fetch calls are made
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should refetch feature and messages when feature update callback is fired", async () => {
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

    const onFeatureUpdated = latestPusherOptions?.onFeatureUpdated as (() => void) | undefined;
    onFeatureUpdated?.();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123");
      expect(mockFetch).toHaveBeenCalledWith("/api/features/feature-123/chat");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  it("should reconcile workflowStatus and loading from feature refetch on stale connection", async () => {
    mockFetch.mockImplementation((url: string, options?: { method?: string }) => {
      if (url === "/api/features/feature-123/chat" && options?.method === "POST") {
        return Promise.resolve({
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
      }

      if (url === "/api/features/feature-123") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: "feature-123",
              title: "Feature",
              workflowStatus: WorkflowStatus.COMPLETED,
              userStories: [],
            },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({ data: [] }),
      });
    });

    render(<PlanChatView featureId="feature-123" workspaceSlug="test-workspace" workspaceId="workspace-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-area")).toBeInTheDocument();
    });

    const submitButton = screen.getByTestId("artifact-action-button");
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByTestId("chat-workflow-status")).toHaveTextContent(WorkflowStatus.IN_PROGRESS);
      expect(screen.getByTestId("chat-is-loading")).toHaveTextContent("true");
    });

    const onStaleConnection = latestPusherOptions?.onStaleConnection as (() => void) | undefined;
    onStaleConnection?.();

    await waitFor(() => {
      expect(screen.getByTestId("chat-workflow-status")).toHaveTextContent(WorkflowStatus.COMPLETED);
      expect(screen.getByTestId("chat-is-loading")).toHaveTextContent("false");
    });
  });

});
