import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanChatView } from "@/app/w/[slug]/plan/[featureId]/components/PlanChatView";
import { ChatRole, ChatStatus } from "@/lib/chat";

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

});
