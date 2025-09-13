import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { ChatArea } from "@/app/w/[slug]/task/[...taskParams]/components/ChatArea";
import { ChatMessage as ChatMessageType, WorkflowStatus } from "@/lib/chat";

// Mock Next.js router
const mockPush = vi.fn();
const mockBack = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

// Mock framer-motion components
vi.mock("framer-motion", () => ({
  motion: {
    div: vi.fn(({ children, ...props }) => <div {...props}>{children}</div>),
    h2: vi.fn(({ children, ...props }) => <h2 {...props}>{children}</h2>),
  },
  AnimatePresence: vi.fn(({ children }) => <>{children}</>),
}));

// Mock ChatMessage component
vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ChatMessage", () => ({
  ChatMessage: vi.fn(({ message, replyMessage, onArtifactAction }) => (
    <div data-testid={`chat-message-${message.id}`}>
      <span data-testid={`message-content-${message.id}`}>{message.message}</span>
      {replyMessage && (
        <span data-testid={`reply-message-${message.id}`}>{replyMessage.message}</span>
      )}
      <button
        data-testid={`artifact-action-${message.id}`}
        onClick={() => onArtifactAction?.(message.id, { optionResponse: "test-option" }, "test-webhook")}
      >
        Trigger Action
      </button>
    </div>
  )),
}));

// Mock ChatInput component
vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ChatInput", () => ({
  ChatInput: vi.fn(({ 
    onSend, 
    disabled, 
    isLoading, 
    logs, 
    pendingDebugAttachment, 
    onRemoveDebugAttachment, 
    workflowStatus 
  }) => (
    <div data-testid="chat-input">
      <input
        data-testid="message-input"
        disabled={disabled}
        placeholder={isLoading ? "Sending..." : "Type message..."}
      />
      <button
        data-testid="send-button"
        onClick={() => onSend?.("test message")}
        disabled={disabled || isLoading}
      >
        {isLoading ? "Sending..." : "Send"}
      </button>
      {pendingDebugAttachment && (
        <div data-testid="debug-attachment">
          <span>Debug attachment present</span>
          <button onClick={onRemoveDebugAttachment}>Remove</button>
        </div>
      )}
      {logs && logs.length > 0 && (
        <div data-testid="chat-input-logs">
          {logs.map((log, index) => (
            <span key={index}>{log.message}</span>
          ))}
        </div>
      )}
      {workflowStatus && (
        <span data-testid="workflow-status">{workflowStatus}</span>
      )}
    </div>
  )),
}));

// Mock icons
vi.mock("@/lib/icons", () => ({
  getAgentIcon: vi.fn(() => <div data-testid="agent-icon">🤖</div>),
}));

// Mock UI Button component
vi.mock("@/components/ui/button", () => ({
  Button: vi.fn(({ children, onClick, variant, size, className, ...props }) => (
    <button
      onClick={onClick}
      data-variant={variant}
      data-size={size}
      className={className}
      {...props}
    >
      {children}
    </button>
  )),
}));

// Mock Link component
vi.mock("next/link", () => ({
  __esModule: true,
  default: vi.fn(({ children, href, ...props }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )),
}));

describe("ChatArea Component", () => {
  const mockOnSend = vi.fn();
  const mockOnArtifactAction = vi.fn();
  const mockOnRemoveDebugAttachment = vi.fn();

  const defaultProps = {
    messages: [],
    onSend: mockOnSend,
    onArtifactAction: mockOnArtifactAction,
    inputDisabled: false,
    isLoading: false,
    hasNonFormArtifacts: false,
    isChainVisible: false,
    lastLogLine: "",
    logs: [],
    pendingDebugAttachment: null,
    onRemoveDebugAttachment: mockOnRemoveDebugAttachment,
    workflowStatus: WorkflowStatus.PENDING,
    taskTitle: null,
    stakworkProjectId: null,
    workspaceSlug: "test-workspace",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as vi.Mock).mockReturnValue({
      push: mockPush,
      back: mockBack,
    });
  });

  describe("Message Rendering", () => {
    test("should render messages correctly", () => {
      const messages: ChatMessageType[] = [
        {
          id: "msg-1",
          message: "Hello world",
          role: "USER",
          status: "SENT",
          artifacts: [],
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "msg-2",
          message: "Hi there",
          role: "ASSISTANT",
          status: "SENT",
          artifacts: [],
          createdAt: "2024-01-01T00:01:00Z",
        },
      ];

      render(<ChatArea {...defaultProps} messages={messages} />);

      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
      expect(screen.getByTestId("chat-message-msg-2")).toBeInTheDocument();
      expect(screen.getByTestId("message-content-msg-1")).toHaveTextContent("Hello world");
      expect(screen.getByTestId("message-content-msg-2")).toHaveTextContent("Hi there");
    });

    test("should filter out reply messages from main display", () => {
      const messages: ChatMessageType[] = [
        {
          id: "msg-1",
          message: "Original message",
          role: "USER",
          status: "SENT",
          artifacts: [],
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "msg-2",
          message: "Reply message",
          role: "USER",
          status: "SENT",
          replyId: "msg-1",
          artifacts: [],
          createdAt: "2024-01-01T00:01:00Z",
        },
      ];

      render(<ChatArea {...defaultProps} messages={messages} />);

      // Original message should be displayed
      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
      expect(screen.getByTestId("message-content-msg-1")).toHaveTextContent("Original message");
      
      // Reply message should NOT be displayed as a separate message
      expect(screen.queryByTestId("chat-message-msg-2")).not.toBeInTheDocument();
    });

    test("should pass reply message to ChatMessage component", () => {
      const messages: ChatMessageType[] = [
        {
          id: "msg-1",
          message: "Original message",
          role: "ASSISTANT",
          status: "SENT",
          artifacts: [],
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "msg-2",
          message: "Reply message",
          role: "USER",
          status: "SENT",
          replyId: "msg-1",
          artifacts: [],
          createdAt: "2024-01-01T00:01:00Z",
        },
      ];

      render(<ChatArea {...defaultProps} messages={messages} />);

      // Reply message should be passed to the original ChatMessage component
      expect(screen.getByTestId("reply-message-msg-1")).toBeInTheDocument();
      expect(screen.getByTestId("reply-message-msg-1")).toHaveTextContent("Reply message");
    });

    test("should handle empty messages array", () => {
      render(<ChatArea {...defaultProps} messages={[]} />);

      // No chat messages should be rendered
      expect(screen.queryByTestId(/^chat-message-/)).not.toBeInTheDocument();
      
      // Chat input should still be present
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    test("should call onArtifactAction when artifact action is triggered", () => {
      const messages: ChatMessageType[] = [
        {
          id: "msg-1",
          message: "Message with artifact",
          role: "ASSISTANT",
          status: "SENT",
          artifacts: [
            {
              id: "artifact-1",
              type: "FORM",
              content: {
                actionText: "Choose an option",
                options: [{ optionLabel: "Option 1", optionResponse: "opt1", actionType: "button" }],
                webhook: "test-webhook",
              },
            },
          ],
          createdAt: "2024-01-01T00:00:00Z",
        },
      ];

      render(<ChatArea {...defaultProps} messages={messages} />);

      fireEvent.click(screen.getByTestId("artifact-action-msg-1"));

      expect(mockOnArtifactAction).toHaveBeenCalledWith(
        "msg-1",
        { optionResponse: "test-option" },
        "test-webhook"
      );
    });

    test("should handle messages with undefined artifacts", () => {
      const messages: ChatMessageType[] = [
        {
          id: "msg-1",
          message: "Simple message",
          role: "USER",
          status: "SENT",
          artifacts: undefined,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ];

      render(<ChatArea {...defaultProps} messages={messages} />);

      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
      expect(screen.getByTestId("message-content-msg-1")).toHaveTextContent("Simple message");
    });
  });

  describe("Navigation Handling", () => {
    test("should navigate back to tasks when workspaceSlug is provided", () => {
      render(
        <ChatArea
          {...defaultProps}
          taskTitle="Test Task"
          workspaceSlug="my-workspace"
        />
      );

      const backButton = screen.getAllByRole("button")[0];
      fireEvent.click(backButton);

      expect(mockPush).toHaveBeenCalledWith("/w/my-workspace/tasks");
      expect(mockBack).not.toHaveBeenCalled();
    });

    test("should use router.back() when workspaceSlug is not provided", () => {
      render(
        <ChatArea
          {...defaultProps}
          taskTitle="Test Task"
          workspaceSlug={undefined}
        />
      );

      const backButton = screen.getAllByRole("button")[0];
      fireEvent.click(backButton);

      expect(mockBack).toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    test("should not show task header when taskTitle is not provided", () => {
      render(<ChatArea {...defaultProps} taskTitle={null} />);

      // No task header buttons should be rendered (only send button from ChatInput)
      expect(screen.getAllByRole("button")).toHaveLength(1); // Only the send button
      expect(screen.queryByText("Test Task")).not.toBeInTheDocument();
    });

    test("should handle router navigation gracefully when methods are undefined", () => {
      (useRouter as vi.Mock).mockReturnValue({
        push: undefined,
        back: undefined,
      });

      render(
        <ChatArea
          {...defaultProps}
          taskTitle="Test Task"
          workspaceSlug="test-workspace"
        />
      );

      const backButton = screen.getAllByRole("button")[0];
      
      // Should not throw error when router methods are undefined
      expect(() => fireEvent.click(backButton)).not.toThrow();
    });
  });

  describe("UI State Management", () => {
    test("should display task title when provided", () => {
      const taskTitle = "My Important Task";
      render(<ChatArea {...defaultProps} taskTitle={taskTitle} />);

      expect(screen.getByText(taskTitle)).toBeInTheDocument();
    });

    test("should truncate long task titles", () => {
      const longTitle = "A".repeat(80);
      const expectedTitle = "A".repeat(60) + "...";
      
      render(<ChatArea {...defaultProps} taskTitle={longTitle} />);

      expect(screen.getByText(expectedTitle)).toBeInTheDocument();
      expect(screen.queryByText(longTitle)).not.toBeInTheDocument();
    });

    test("should display Stakwork project link when stakworkProjectId is provided", () => {
      render(
        <ChatArea
          {...defaultProps}
          taskTitle="Test Task"
          stakworkProjectId={12345}
        />
      );

      const workflowLink = screen.getByText("Workflow");
      expect(workflowLink).toBeInTheDocument();
      expect(workflowLink.closest("a")).toHaveAttribute(
        "href",
        "https://jobs.stakwork.com/admin/projects/12345"
      );
      expect(workflowLink.closest("a")).toHaveAttribute("target", "_blank");
      expect(workflowLink.closest("a")).toHaveAttribute("rel", "noopener noreferrer");
    });

    test("should not display Stakwork project link when stakworkProjectId is not provided", () => {
      render(
        <ChatArea
          {...defaultProps}
          taskTitle="Test Task"
          stakworkProjectId={null}
        />
      );

      expect(screen.queryByText("Workflow")).not.toBeInTheDocument();
    });

    test("should show chain visible indicator when isChainVisible is true", () => {
      render(
        <ChatArea
          {...defaultProps}
          isChainVisible={true}
          lastLogLine="Processing request..."
        />
      );

      expect(screen.getByText("Processing request...")).toBeInTheDocument();
      expect(screen.getByText("Hive")).toBeInTheDocument();
      expect(screen.getByTestId("agent-icon")).toBeInTheDocument();
      expect(screen.getByText("Processing...")).toBeInTheDocument();
    });

    test("should show default message when isChainVisible is true but no lastLogLine", () => {
      render(<ChatArea {...defaultProps} isChainVisible={true} lastLogLine="" />);

      expect(screen.getByText("Communicating with workflow...")).toBeInTheDocument();
      expect(screen.getByText("Hive")).toBeInTheDocument();
      expect(screen.getByText("Processing...")).toBeInTheDocument();
    });

    test("should hide chain indicator when isChainVisible is false", () => {
      render(<ChatArea {...defaultProps} isChainVisible={false} />);

      expect(screen.queryByText("Communicating with workflow...")).not.toBeInTheDocument();
      expect(screen.queryByText("Hive")).not.toBeInTheDocument();
      expect(screen.queryByText("Processing...")).not.toBeInTheDocument();
    });

    test("should pass correct props to ChatInput component", () => {
      const logs = [
        { message: "Test log 1", timestamp: "2024-01-01T00:00:00Z" },
        { message: "Test log 2", timestamp: "2024-01-01T00:01:00Z" },
      ];
      
      const debugAttachment = {
        id: "debug-1",
        type: "DEBUG",
        content: { coordinates: { x: 100, y: 200 } },
      };

      render(
        <ChatArea
          {...defaultProps}
          logs={logs}
          inputDisabled={true}
          isLoading={true}
          workflowStatus={WorkflowStatus.IN_PROGRESS}
          pendingDebugAttachment={debugAttachment}
        />
      );

      const chatInput = screen.getByTestId("chat-input");
      expect(chatInput).toBeInTheDocument();
      
      // Check input is disabled
      const messageInput = screen.getByTestId("message-input");
      expect(messageInput).toBeDisabled();
      expect(messageInput).toHaveAttribute("placeholder", "Sending...");
      
      // Check send button is disabled and shows loading state
      const sendButton = screen.getByTestId("send-button");
      expect(sendButton).toBeDisabled();
      expect(sendButton).toHaveTextContent("Sending...");
      
      // Check logs are passed through
      expect(screen.getByTestId("chat-input-logs")).toBeInTheDocument();
      expect(screen.getByText("Test log 1")).toBeInTheDocument();
      expect(screen.getByText("Test log 2")).toBeInTheDocument();
      
      // Check workflow status is passed through
      expect(screen.getByTestId("workflow-status")).toHaveTextContent("IN_PROGRESS");
      
      // Check debug attachment is passed through
      expect(screen.getByTestId("debug-attachment")).toBeInTheDocument();
    });

    test("should handle onSend callback from ChatInput", () => {
      render(<ChatArea {...defaultProps} />);

      fireEvent.click(screen.getByTestId("send-button"));

      expect(mockOnSend).toHaveBeenCalledWith("test message");
    });

    test("should handle onRemoveDebugAttachment callback", () => {
      const debugAttachment = {
        id: "debug-1",
        type: "DEBUG",
        content: { coordinates: { x: 100, y: 200 } },
      };

      render(
        <ChatArea
          {...defaultProps}
          pendingDebugAttachment={debugAttachment}
        />
      );

      fireEvent.click(screen.getByText("Remove"));

      expect(mockOnRemoveDebugAttachment).toHaveBeenCalled();
    });

    test("should handle different workflow statuses", () => {
      const testStatuses = [
        WorkflowStatus.PENDING,
        WorkflowStatus.IN_PROGRESS,
        WorkflowStatus.COMPLETED,
        WorkflowStatus.ERROR,
        WorkflowStatus.FAILED,
        WorkflowStatus.HALTED,
      ];

      testStatuses.forEach(status => {
        const { rerender } = render(
          <ChatArea {...defaultProps} workflowStatus={status} />
        );

        expect(screen.getByTestId("workflow-status")).toHaveTextContent(status);

        // Clean up for next iteration
        rerender(<div />);
      });
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("should handle undefined callback props gracefully", () => {
      render(
        <ChatArea
          {...defaultProps}
          onSend={undefined}
          onArtifactAction={undefined}
          onRemoveDebugAttachment={undefined}
        />
      );

      // Component should render without errors
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    test("should handle null/undefined optional props", () => {
      render(
        <ChatArea
          {...defaultProps}
          taskTitle={null}
          stakworkProjectId={null}
          lastLogLine={undefined}
          logs={undefined}
          pendingDebugAttachment={null}
          workflowStatus={null}
        />
      );

      // Should render without task title header
      expect(screen.queryByText("Test Task")).not.toBeInTheDocument();
      expect(screen.queryByText("Workflow")).not.toBeInTheDocument();
      
      // Chat input should still be present
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    test("should handle empty lastLogLine with chain visible", () => {
      render(
        <ChatArea
          {...defaultProps}
          isChainVisible={true}
          lastLogLine=""
        />
      );

      expect(screen.getByText("Communicating with workflow...")).toBeInTheDocument();
    });

    test("should handle empty or undefined logs array", () => {
      render(
        <ChatArea
          {...defaultProps}
          logs={[]}
        />
      );

      expect(screen.queryByTestId("chat-input-logs")).not.toBeInTheDocument();

      const { rerender } = render(
        <ChatArea
          {...defaultProps}
          logs={undefined}
        />
      );

      expect(screen.queryByTestId("chat-input-logs")).not.toBeInTheDocument();
    });

    test("should maintain message rendering when props update", () => {
      const initialMessages: ChatMessageType[] = [
        {
          id: "msg-1",
          message: "First message",
          role: "USER",
          status: "SENT",
          artifacts: [],
          createdAt: "2024-01-01T00:00:00Z",
        },
      ];

      const { rerender } = render(<ChatArea {...defaultProps} messages={initialMessages} />);

      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();

      // Add new message
      const updatedMessages = [
        ...initialMessages,
        {
          id: "msg-2",
          message: "Second message",
          role: "ASSISTANT",
          status: "SENT",
          artifacts: [],
          createdAt: "2024-01-01T00:01:00Z",
        },
      ];

      rerender(<ChatArea {...defaultProps} messages={updatedMessages} />);

      // Both messages should be rendered
      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
      expect(screen.getByTestId("chat-message-msg-2")).toBeInTheDocument();
    });

    test("should handle complex message filtering with multiple replies", () => {
      const messages: ChatMessageType[] = [
        {
          id: "msg-1",
          message: "Original message 1",
          role: "USER",
          status: "SENT",
          artifacts: [],
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "msg-2",
          message: "Reply to msg-1",
          role: "ASSISTANT",
          status: "SENT",
          replyId: "msg-1",
          artifacts: [],
          createdAt: "2024-01-01T00:01:00Z",
        },
        {
          id: "msg-3",
          message: "Original message 2",
          role: "USER",
          status: "SENT",
          artifacts: [],
          createdAt: "2024-01-01T00:02:00Z",
        },
        {
          id: "msg-4",
          message: "Reply to msg-3",
          role: "ASSISTANT",
          status: "SENT",
          replyId: "msg-3",
          artifacts: [],
          createdAt: "2024-01-01T00:03:00Z",
        },
      ];

      render(<ChatArea {...defaultProps} messages={messages} />);

      // Only original messages should be displayed
      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
      expect(screen.getByTestId("chat-message-msg-3")).toBeInTheDocument();
      
      // Reply messages should not be displayed as separate messages
      expect(screen.queryByTestId("chat-message-msg-2")).not.toBeInTheDocument();
      expect(screen.queryByTestId("chat-message-msg-4")).not.toBeInTheDocument();
      
      // But replies should be passed to their respective original messages
      expect(screen.getByTestId("reply-message-msg-1")).toBeInTheDocument();
      expect(screen.getByTestId("reply-message-msg-3")).toBeInTheDocument();
    });
  });
});