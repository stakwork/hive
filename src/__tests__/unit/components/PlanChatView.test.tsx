import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { PlanChatView } from "@/app/w/[slug]/plan/[featureId]/components/PlanChatView";
import { ChatRole, WorkflowStatus } from "@/lib/chat";

// Mock dependencies
vi.mock("@/components/chat", () => ({
  ChatArea: vi.fn(({ awaitingFeedback }) => (
    <div data-testid="chat-area" data-awaiting-feedback={awaitingFeedback}>
      ChatArea Mock
    </div>
  )),
  ArtifactsPanel: vi.fn(() => <div data-testid="artifacts-panel">ArtifactsPanel Mock</div>),
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: any) => <div>{children}</div>,
  ResizablePanel: ({ children }: any) => <div>{children}</div>,
  ResizableHandle: () => <div>Handle</div>,
}));

vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: vi.fn(),
}));

vi.mock("@/hooks/useDetailResource", () => ({
  useDetailResource: vi.fn(() => ({
    data: null,
    setData: vi.fn(),
    isLoading: false,
    error: null,
  })),
}));

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

// Mock fetch globally
global.fetch = vi.fn();

describe("PlanChatView - awaitingFeedback State", () => {
  const defaultProps = {
    featureId: "feature-123",
    workspaceSlug: "test-workspace",
    workspaceId: "workspace-456",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock successful feature fetch
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/api/features/")) {
        if (url.includes("/chat")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: [] }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: "feature-123",
              title: "Test Feature",
              brief: null,
              requirements: null,
              architecture: null,
              userStories: [],
            },
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: "Not found" }),
      });
    });
  });

  test("awaitingFeedback is true when last message is ASSISTANT and workflowStatus is COMPLETED", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/chat")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "msg-1",
                role: ChatRole.USER,
                message: "Hello",
                status: "SENT",
                artifacts: [],
              },
              {
                id: "msg-2",
                role: ChatRole.ASSISTANT,
                message: "Here is my response",
                status: "SENT",
                artifacts: [],
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { id: "feature-123", title: "Test" } }),
      });
    });

    const { getByTestId } = render(<PlanChatView {...defaultProps} />);

    await waitFor(() => {
      const chatArea = getByTestId("chat-area");
      expect(chatArea).toHaveAttribute("data-awaiting-feedback", "true");
    });
  });

  test("awaitingFeedback is false when last message is USER", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/chat")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "msg-1",
                role: ChatRole.USER,
                message: "Hello",
                status: "SENT",
                artifacts: [],
              },
              {
                id: "msg-2",
                role: ChatRole.ASSISTANT,
                message: "Response",
                status: "SENT",
                artifacts: [],
              },
              {
                id: "msg-3",
                role: ChatRole.USER,
                message: "Thanks",
                status: "SENT",
                artifacts: [],
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { id: "feature-123", title: "Test" } }),
      });
    });

    const { getByTestId } = render(<PlanChatView {...defaultProps} />);

    await waitFor(() => {
      const chatArea = getByTestId("chat-area");
      expect(chatArea).toHaveAttribute("data-awaiting-feedback", "false");
    });
  });

  test("awaitingFeedback is false when messages array is empty", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/chat")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { id: "feature-123", title: "Test" } }),
      });
    });

    const { getByTestId } = render(<PlanChatView {...defaultProps} />);

    await waitFor(() => {
      const chatArea = getByTestId("chat-area");
      expect(chatArea).toHaveAttribute("data-awaiting-feedback", "false");
    });
  });

  test("awaitingFeedback is false when workflowStatus is IN_PROGRESS even if last message is ASSISTANT", async () => {
    // Mock usePusherConnection to simulate workflow status update
    const { usePusherConnection } = await import("@/hooks/usePusherConnection");
    
    let onWorkflowStatusUpdate: ((update: { taskId: string; workflowStatus: WorkflowStatus }) => void) | undefined;
    
    vi.mocked(usePusherConnection).mockImplementation((config: any) => {
      onWorkflowStatusUpdate = config.onWorkflowStatusUpdate;
    });

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/chat")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "msg-1",
                role: ChatRole.ASSISTANT,
                message: "Working on it...",
                status: "SENT",
                artifacts: [],
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { id: "feature-123", title: "Test" } }),
      });
    });

    const { getByTestId } = render(<PlanChatView {...defaultProps} />);

    // Wait for initial render
    await waitFor(() => {
      const chatArea = getByTestId("chat-area");
      // Initially should be true (no workflow, last message is ASSISTANT)
      expect(chatArea).toHaveAttribute("data-awaiting-feedback", "true");
    });

    // Simulate workflow starting
    if (onWorkflowStatusUpdate) {
      onWorkflowStatusUpdate({ taskId: "feature-123", workflowStatus: WorkflowStatus.IN_PROGRESS });
    }

    await waitFor(() => {
      const chatArea = getByTestId("chat-area");
      // Should be false because workflowStatus is now IN_PROGRESS
      expect(chatArea).toHaveAttribute("data-awaiting-feedback", "false");
    });
  });

  test("awaitingFeedback is false when messages array is empty", async () => {
    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/chat")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { id: "feature-123", title: "Test" } }),
      });
    });

    const { getByTestId } = render(<PlanChatView {...defaultProps} />);

    await waitFor(() => {
      const chatArea = getByTestId("chat-area");
      // Should be false because there are no messages
      expect(chatArea).toHaveAttribute("data-awaiting-feedback", "false");
    });
  });

  test("awaitingFeedback updates reactively when messages change", async () => {
    // Mock usePusherConnection to simulate receiving a new message
    const { usePusherConnection } = await import("@/hooks/usePusherConnection");
    
    let onMessage: ((message: any) => void) | undefined;
    
    vi.mocked(usePusherConnection).mockImplementation((config: any) => {
      onMessage = config.onMessage;
    });

    (global.fetch as any).mockImplementation((url: string) => {
      if (url.includes("/chat")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "msg-1",
                role: ChatRole.ASSISTANT,
                message: "Initial response",
                status: "SENT",
                artifacts: [],
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { id: "feature-123", title: "Test" } }),
      });
    });

    const { getByTestId } = render(<PlanChatView {...defaultProps} />);

    // Initially should be true (last message is ASSISTANT)
    await waitFor(() => {
      const chatArea = getByTestId("chat-area");
      expect(chatArea).toHaveAttribute("data-awaiting-feedback", "true");
    });

    // Simulate receiving a USER message via Pusher
    await act(async () => {
      if (onMessage) {
        onMessage({
          id: "msg-2",
          role: ChatRole.USER,
          message: "User reply",
          status: "SENT",
          artifacts: [],
        });
      }
    });

    // Now awaitingFeedback should be false (last message is USER)
    await waitFor(() => {
      const chatArea = getByTestId("chat-area");
      expect(chatArea).toHaveAttribute("data-awaiting-feedback", "false");
    });
  });
});
