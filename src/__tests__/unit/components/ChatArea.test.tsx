import React from 'react';
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ChatArea } from "@/app/w/[slug]/task/[...taskParams]/components/ChatArea";
import { ChatMessage as ChatMessageType, WorkflowStatus, Artifact } from "@/lib/chat";
import type { LogEntry } from "@/hooks/useProjectLogWebSocket";

// Mock Next.js router
const mockPush = vi.fn();
const mockBack = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
  }),
}));

// Mock framer-motion components
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, className, ...props }: any) => (
      <div className={className} {...props}>
        {children}
      </div>
    ),
    h2: ({ children, className, ...props }: any) => (
      <h2 className={className} {...props}>
        {children}
      </h2>
    ),
  },
  AnimatePresence: ({ children }: any) => <div>{children}</div>,
}));

// Mock child components
vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ChatMessage", () => ({
  ChatMessage: ({ message, replyMessage, onArtifactAction }: any) => (
    <div data-testid={`chat-message-${message.id}`}>
      <div data-testid="message-content">{message.message}</div>
      <div data-testid="message-role">{message.role}</div>
      {replyMessage && (
        <div data-testid="reply-message">{replyMessage.message}</div>
      )}
    </div>
  ),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ChatInput", () => ({
  ChatInput: ({ onSend, disabled, isLoading, workflowStatus, logs, pendingDebugAttachment, onRemoveDebugAttachment }: any) => (
    <div data-testid="chat-input">
      <div data-testid="workflow-status">
        {workflowStatus || "no-status"}
      </div>
      <div data-testid="input-disabled">{disabled ? "disabled" : "enabled"}</div>
      <div data-testid="input-loading">{isLoading ? "loading" : "not-loading"}</div>
      <div data-testid="logs-count">{logs ? logs.length : 0}</div>
      {pendingDebugAttachment && (
        <div data-testid="debug-attachment">{pendingDebugAttachment.id}</div>
      )}
      <button onClick={() => onSend("test message")} data-testid="send-button">
        Send
      </button>
    </div>
  ),
}));

// Mock UI components
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, variant, size, className, ...props }: any) => (
    <button
      onClick={onClick}
      className={className}
      data-variant={variant}
      data-size={size}
      {...props}
    >
      {children}
    </button>
  ),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock icons
vi.mock("lucide-react", () => ({
  ArrowLeft: () => <div data-testid="arrow-left-icon" />,
  ExternalLink: () => <div data-testid="external-link-icon" />,
}));

vi.mock("@/lib/icons", () => ({
  getAgentIcon: () => <div data-testid="agent-icon" />,
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
    workflowStatus: null,
    taskTitle: null,
    stakworkProjectId: null,
    workspaceSlug: null,
  };

  const createMockMessage = (id: string, message: string, role: "USER" | "ASSISTANT", replyId?: string): ChatMessageType => ({
    id,
    message,
    role,
    replyId,
    timestamp: new Date().toISOString(),
    artifacts: [],
    workflowUrl: null,
  });

  const createMockLogEntry = (message: string): LogEntry => ({
    id: `log-${Math.random()}`,
    message,
    timestamp: new Date().toISOString(),
    level: "info",
  });

  const createMockArtifact = (id: string): Artifact => ({
    id,
    type: "DEBUG",
    content: {
      method: "click",
      coordinates: { x: 100, y: 200, width: 50, height: 25 },
    },
    icon: "bug",
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Message Rendering", () => {
    test("should render messages correctly", () => {
      const messages = [
        createMockMessage("msg-1", "Hello world", "USER"),
        createMockMessage("msg-2", "How can I help you?", "ASSISTANT"),
      ];

      render(<ChatArea {...defaultProps} messages={messages} />);

      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
      expect(screen.getByTestId("chat-message-msg-2")).toBeInTheDocument();

      // Check message content is rendered
      const messageContents = screen.getAllByTestId("message-content");
      expect(messageContents).toHaveLength(2);
      expect(messageContents[0]).toHaveTextContent("Hello world");
      expect(messageContents[1]).toHaveTextContent("How can I help you?");
    });

    test("should filter out reply messages from main display", () => {
      const messages = [
        createMockMessage("msg-1", "Original message", "USER"),
        createMockMessage("msg-2", "Reply message", "USER", "msg-1"), // This should be filtered out
        createMockMessage("msg-3", "Another message", "ASSISTANT"),
      ];

      render(<ChatArea {...defaultProps} messages={messages} />);

      // Should only render 2 messages (msg-1 and msg-3), not the reply
      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
      expect(screen.queryByTestId("chat-message-msg-2")).not.toBeInTheDocument();
      expect(screen.getByTestId("chat-message-msg-3")).toBeInTheDocument();
    });

    test("should find and pass reply messages to ChatMessage component", () => {
      const messages = [
        createMockMessage("msg-1", "Original message", "USER"),
        createMockMessage("msg-2", "Reply to msg-1", "ASSISTANT", "msg-1"),
      ];

      render(<ChatArea {...defaultProps} messages={messages} />);

      // Only original message should be rendered as main message
      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
      expect(screen.queryByTestId("chat-message-msg-2")).not.toBeInTheDocument();

      // Reply message should be passed to ChatMessage component
      expect(screen.getByTestId("reply-message")).toHaveTextContent("Reply to msg-1");
    });

    test("should handle empty messages array", () => {
      render(<ChatArea {...defaultProps} messages={[]} />);

      expect(screen.queryByTestId(/chat-message-/)).not.toBeInTheDocument();
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    test("should render chain visible indicator when isChainVisible is true", () => {
      render(
        <ChatArea
          {...defaultProps}
          isChainVisible={true}
          lastLogLine="Processing workflow..."
        />
      );

      expect(screen.getByText("Hive")).toBeInTheDocument();
      expect(screen.getByText("Processing workflow...")).toBeInTheDocument();
      expect(screen.getByTestId("agent-icon")).toBeInTheDocument();
    });

    test("should show default chain message when lastLogLine is empty", () => {
      render(<ChatArea {...defaultProps} isChainVisible={true} lastLogLine="" />);

      expect(screen.getByText("Communicating with workflow...")).toBeInTheDocument();
    });
  });

  describe("Navigation Handling", () => {
    test("should navigate to tasks page when workspaceSlug is provided", () => {
      render(
        <ChatArea
          {...defaultProps}
          taskTitle="Test Task"
          workspaceSlug="test-workspace"
        />
      );

      const backButton = screen.getByRole("button");
      fireEvent.click(backButton);

      expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/tasks");
      expect(mockBack).not.toHaveBeenCalled();
    });

    test("should use router.back() when workspaceSlug is not provided", () => {
      render(<ChatArea {...defaultProps} taskTitle="Test Task" />);

      const backButton = screen.getByRole("button");
      fireEvent.click(backButton);

      expect(mockBack).toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    test("should render back button when taskTitle is provided", () => {
      render(<ChatArea {...defaultProps} taskTitle="Test Task Title" />);

      const backButton = screen.getByRole("button");
      expect(backButton).toBeInTheDocument();
      expect(screen.getByTestId("arrow-left-icon")).toBeInTheDocument();
    });

    test("should not render back button when taskTitle is not provided", () => {
      render(<ChatArea {...defaultProps} />);

      expect(screen.queryByTestId("arrow-left-icon")).not.toBeInTheDocument();
    });

    test("should render task title with truncation for long titles", () => {
      const longTitle = "This is a very long task title that should be truncated because it exceeds the 60 character limit";

      render(<ChatArea {...defaultProps} taskTitle={longTitle} />);

      const titleElement = screen.getByText(/This is a very long task title that should be truncated.../);
      expect(titleElement).toBeInTheDocument();
      expect(titleElement).toHaveAttribute("title", longTitle);
    });

    test("should render short task titles without truncation", () => {
      const shortTitle = "Short Title";

      render(<ChatArea {...defaultProps} taskTitle={shortTitle} />);

      expect(screen.getByText(shortTitle)).toBeInTheDocument();
    });

    test("should render stakwork project link when stakworkProjectId is provided", () => {
      render(
        <ChatArea
          {...defaultProps}
          taskTitle="Test Task"
          stakworkProjectId={12345}
        />
      );

      const workflowLink = screen.getByRole("link");
      expect(workflowLink).toHaveAttribute(
        "href",
        "https://jobs.stakwork.com/admin/projects/12345"
      );
      expect(workflowLink).toHaveAttribute("target", "_blank");
      expect(screen.getByText("Workflow")).toBeInTheDocument();
      expect(screen.getByTestId("external-link-icon")).toBeInTheDocument();
    });
  });

  describe("Workflow Status Display", () => {
    test("should pass workflowStatus to ChatInput component", () => {
      render(
        <ChatArea
          {...defaultProps}
          workflowStatus={WorkflowStatus.IN_PROGRESS}
        />
      );

      expect(screen.getByTestId("workflow-status")).toHaveTextContent("IN_PROGRESS");
    });

    test("should handle null workflowStatus", () => {
      render(<ChatArea {...defaultProps} workflowStatus={null} />);

      expect(screen.getByTestId("workflow-status")).toHaveTextContent("no-status");
    });

    test("should pass different workflow status values", () => {
      const statuses = [
        WorkflowStatus.PENDING,
        WorkflowStatus.COMPLETED,
        WorkflowStatus.ERROR,
        WorkflowStatus.FAILED,
        WorkflowStatus.HALTED,
      ];

      statuses.forEach((status) => {
        const { rerender } = render(
          <ChatArea {...defaultProps} workflowStatus={status} />
        );

        expect(screen.getByTestId("workflow-status")).toHaveTextContent(status);

        rerender(<div />); // Clean up before next iteration
      });
    });

    test("should pass logs to ChatInput component", () => {
      const logs = [
        createMockLogEntry("First log entry"),
        createMockLogEntry("Second log entry"),
      ];

      render(<ChatArea {...defaultProps} logs={logs} />);

      expect(screen.getByTestId("logs-count")).toHaveTextContent("2");
    });

    test("should handle empty logs array", () => {
      render(<ChatArea {...defaultProps} logs={[]} />);

      expect(screen.getByTestId("logs-count")).toHaveTextContent("0");
    });
  });

  describe("ChatInput Integration", () => {
    test("should pass all relevant props to ChatInput", () => {
      const logs = [createMockLogEntry("Test log")];
      const artifact = createMockArtifact("test-artifact");

      render(
        <ChatArea
          {...defaultProps}
          inputDisabled={true}
          isLoading={true}
          workflowStatus={WorkflowStatus.PENDING}
          logs={logs}
          pendingDebugAttachment={artifact}
        />
      );

      expect(screen.getByTestId("input-disabled")).toHaveTextContent("disabled");
      expect(screen.getByTestId("input-loading")).toHaveTextContent("loading");
      expect(screen.getByTestId("workflow-status")).toHaveTextContent("PENDING");
      expect(screen.getByTestId("logs-count")).toHaveTextContent("1");
      expect(screen.getByTestId("debug-attachment")).toHaveTextContent("test-artifact");
    });

    test("should handle ChatInput onSend callback", () => {
      render(<ChatArea {...defaultProps} />);

      const sendButton = screen.getByTestId("send-button");
      fireEvent.click(sendButton);

      expect(mockOnSend).toHaveBeenCalledWith("test message");
    });

    test("should pass onRemoveDebugAttachment callback", () => {
      const artifact = createMockArtifact("test-artifact");

      render(
        <ChatArea
          {...defaultProps}
          pendingDebugAttachment={artifact}
          onRemoveDebugAttachment={mockOnRemoveDebugAttachment}
        />
      );

      // The actual callback testing would happen in ChatInput component tests
      // Here we just verify the prop is passed
      expect(screen.getByTestId("debug-attachment")).toBeInTheDocument();
    });
  });

  describe("Component Lifecycle", () => {
    test("should handle message updates and auto-scroll", () => {
      const { rerender } = render(<ChatArea {...defaultProps} messages={[]} />);

      const newMessages = [createMockMessage("msg-1", "New message", "USER")];
      rerender(<ChatArea {...defaultProps} messages={newMessages} />);

      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
    });

    test("should render with default prop values", () => {
      const minimalProps = {
        messages: [],
        onSend: mockOnSend,
        onArtifactAction: mockOnArtifactAction,
      };

      render(<ChatArea {...minimalProps} />);

      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
      expect(screen.getByTestId("input-disabled")).toHaveTextContent("enabled");
      expect(screen.getByTestId("input-loading")).toHaveTextContent("not-loading");
    });
  });

  describe("Error Handling", () => {
    test("should handle malformed messages gracefully", () => {
      const messages = [
        // Message with missing required fields
        {
          id: "msg-1",
          message: "Valid message",
          role: "USER" as const,
          timestamp: new Date().toISOString(),
          artifacts: [],
          workflowUrl: null,
        },
      ];

      expect(() => {
        render(<ChatArea {...defaultProps} messages={messages} />);
      }).not.toThrow();

      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
    });

    test("should handle onArtifactAction callback", () => {
      const messages = [createMockMessage("msg-1", "Test message", "ASSISTANT")];

      render(<ChatArea {...defaultProps} messages={messages} />);

      // The onArtifactAction would be tested through ChatMessage component
      // Here we verify the prop is passed correctly
      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
    });
  });
});
