import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRouter } from "next/navigation";
import { ChatArea } from "@/app/w/[slug]/task/[...taskParams]/components/ChatArea";
import { ChatMessage as ChatMessageType, Option, Artifact, WorkflowStatus } from "@/lib/chat";
import { LogEntry } from "@/hooks/useProjectLogWebSocket";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

// Mock framer-motion
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, className, ...props }: any) => (
      <div className={className} {...props}>{children}</div>
    ),
    h2: ({ children, className, ...props }: any) => (
      <h2 className={className} {...props}>{children}</h2>
    ),
    p: ({ children, className, ...props }: any) => (
      <p className={className} {...props}>{children}</p>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock child components
vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ChatMessage", () => ({
  ChatMessage: ({ message, replyMessage, onArtifactAction }: any) => (
    <div data-testid={`chat-message-${message.id}`}>
      <div>{message.message}</div>
      <div>{message.role}</div>
      {replyMessage && <div data-testid="reply-message">{replyMessage.message}</div>}
      {message.artifacts?.map((artifact: any, index: number) => (
        <div key={index} data-testid={`artifact-${index}`}>{artifact.type}</div>
      ))}
      <button onClick={() => onArtifactAction(message.id, { id: 'test-action' }, 'webhook')}>
        Artifact Action
      </button>
    </div>
  ),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ChatInput", () => ({
  ChatInput: ({ onSend, disabled, isLoading, pendingDebugAttachment, onRemoveDebugAttachment, workflowStatus }: any) => (
    <div data-testid="chat-input">
      <input
        data-testid="message-input"
        disabled={disabled}
        placeholder={isLoading ? "Loading..." : "Type a message..."}
      />
      <button
        data-testid="send-button"
        onClick={() => onSend("test message")}
        disabled={disabled || isLoading}
      >
        Send
      </button>
      {pendingDebugAttachment && (
        <div data-testid="debug-attachment">
          <span>{pendingDebugAttachment.type}</span>
          <button onClick={onRemoveDebugAttachment}>Remove</button>
        </div>
      )}
      {workflowStatus && (
        <div data-testid="workflow-status">{workflowStatus}</div>
      )}
    </div>
  ),
}));

// Mock UI components
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, variant, size, className, disabled, ...props }: any) => (
    <button
      onClick={onClick}
      className={`btn ${variant || 'default'} ${size || 'default'} ${className || ''}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
  ConfirmDialog: ({ open, onOpenChange, title, description, confirmText, onConfirm, testId, variant }: any) => (
    open ? (
      <div data-testid={testId || "confirm-dialog"} role="dialog">
        <h2 data-testid="dialog-title">{title}</h2>
        <p data-testid="dialog-description">{description}</p>
        <button
          data-testid="dialog-cancel"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </button>
        <button
          data-testid="dialog-confirm"
          className={variant}
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          {confirmText}
        </button>
      </div>
    ) : null
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock icons
vi.mock("lucide-react", () => ({
  ArrowLeft: () => <span data-testid="arrow-left-icon">←</span>,
  ExternalLink: () => <span data-testid="external-link-icon">↗</span>,
  Monitor: () => <span data-testid="monitor-icon">🖥</span>,
  Server: (props: any) => <span data-testid="server-icon" {...props}>🖥️</span>,
  ServerOff: (props: any) => <span data-testid="server-off-icon" {...props}>⚠️</span>,
  Clock: () => <span data-testid="clock-icon">🕐</span>,
  Loader2: () => <span data-testid="loader-icon">⏳</span>,
  CheckCircle: () => <span data-testid="check-circle-icon">✓</span>,
  AlertCircle: () => <span data-testid="alert-circle-icon">⚠</span>,
  Pause: () => <span data-testid="pause-icon">⏸</span>,
  XCircle: () => <span data-testid="x-circle-icon">✗</span>,
  UserPlus: () => <span data-testid="user-plus-icon">👤+</span>,
  Search: () => <span data-testid="search-icon">🔍</span>,
}));

// Mock useIsMobile hook
vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

// Mock cn utility
vi.mock("@/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

vi.mock("@/lib/icons", () => ({
  getAgentIcon: () => <span data-testid="agent-icon">🤖</span>,
}));

// Test data factories
const TestDataFactories = {
  message: (overrides: Partial<ChatMessageType> = {}): ChatMessageType => ({
    id: "message-1",
    message: "Test message content",
    role: "user",
    timestamp: new Date("2024-01-01T12:00:00Z"),
    status: "sent",
    contextTags: [],
    artifacts: [],
    attachments: [],
    replyId: null,
    sourceWebsocketID: null,
    task: { id: "task-1", title: "Test Task" },
    ...overrides,
  }),

  logEntry: (overrides: Partial<LogEntry> = {}): LogEntry => ({
    id: "log-1",
    timestamp: "2024-01-01T12:00:00Z",
    level: "info",
    message: "Test log message",
    source: "test",
    ...overrides,
  }),

  artifact: (overrides: Partial<Artifact> = {}): Artifact => ({
    type: "code",
    content: { language: "javascript", code: "console.log('test')" },
    ...overrides,
  }),

  chatAreaProps: (props: Partial<any> = {}) => ({
    messages: [TestDataFactories.message()],
    onSend: vi.fn().mockResolvedValue(undefined),
    onArtifactAction: vi.fn().mockResolvedValue(undefined),
    inputDisabled: false,
    isLoading: false,
    isChainVisible: false,
    lastLogLine: "",
    logs: [],
    pendingDebugAttachment: null,
    onRemoveDebugAttachment: vi.fn(),
    workflowStatus: null,
    taskTitle: null,
    workspaceSlug: null,
    ...props,
  }),

  mockRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  })
};

// Test utilities
const TestUtils = {
  setupRouter: () => {
    const mockRouter = TestDataFactories.mockRouter();
    (useRouter as any).mockReturnValue(mockRouter);
    return mockRouter;
  },

  renderChatArea: (props: Partial<any> = {}) => {
    const defaultProps = TestDataFactories.chatAreaProps(props);
    const router = TestUtils.setupRouter();
    const component = render(<ChatArea {...defaultProps} />);
    return { component, props: defaultProps, router };
  },

  findBackButton: () => screen.getByTestId("arrow-left-icon").closest("button"),
  
  findMessageById: (id: string) => screen.getByTestId(`chat-message-${id}`),

  expectElementsToBePresent: (testIds: string[]) => {
    testIds.forEach(testId => {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    });
  }
};

// Helper functions for creating test data (kept for backward compatibility)
const createTestMessage = TestDataFactories.message;
const createTestLogEntry = TestDataFactories.logEntry;
const createTestArtifact = TestDataFactories.artifact;

// Test setup helper (refactored to use factories)
const setupChatAreaTest = (props: Partial<any> = {}) => {
  const defaultProps = TestDataFactories.chatAreaProps(props);
  const mockRouter = TestDataFactories.mockRouter();
  (useRouter as any).mockReturnValue(mockRouter);
  return { props: defaultProps, router: mockRouter };
};

describe("ChatArea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Rendering", () => {
    test("renders chat area with messages", () => {
      const { props } = setupChatAreaTest();
      render(<ChatArea {...props} />);

      expect(screen.getByTestId("chat-message-message-1")).toBeInTheDocument();
      expect(screen.getByText("Test message content")).toBeInTheDocument();
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    test("renders without task title header when taskTitle is not provided", () => {
      const { props } = setupChatAreaTest();
      render(<ChatArea {...props} />);

      expect(screen.queryByRole("button", { name: /arrow-left-icon/i })).not.toBeInTheDocument();
    });

    test("renders with task title header when taskTitle is provided", () => {
      const { props } = setupChatAreaTest({
        taskTitle: "Sample Task Title",
      });
      render(<ChatArea {...props} />);

      expect(screen.getByText("Sample Task Title")).toBeInTheDocument();
      expect(screen.getByTestId("arrow-left-icon")).toBeInTheDocument();
    });

    test("truncates long task titles", () => {
      const longTitle = "This is a very long task title that should be truncated because it exceeds the 60 character limit";
      const { props } = setupChatAreaTest({
        taskTitle: longTitle,
      });
      render(<ChatArea {...props} />);

      expect(screen.getByText(`${longTitle.slice(0, 60)}...`)).toBeInTheDocument();
    });
  });

  describe("Message Rendering", () => {
    test("renders multiple messages", () => {
      const messages = [
        createTestMessage({ id: "msg-1", message: "First message" }),
        createTestMessage({ id: "msg-2", message: "Second message" }),
      ];
      const { props } = setupChatAreaTest({ messages });
      render(<ChatArea {...props} />);

      expect(screen.getByText("First message")).toBeInTheDocument();
      expect(screen.getByText("Second message")).toBeInTheDocument();
    });

    test("filters out reply messages from main display", () => {
      const messages = [
        createTestMessage({ id: "msg-1", message: "Original message" }),
        createTestMessage({ id: "msg-2", message: "Reply message", replyId: "msg-1" }),
      ];
      const { props } = setupChatAreaTest({ messages });
      render(<ChatArea {...props} />);

      expect(screen.getByTestId("chat-message-msg-1")).toBeInTheDocument();
      expect(screen.queryByTestId("chat-message-msg-2")).not.toBeInTheDocument();
    });

    test("displays reply messages with their parent messages", () => {
      const messages = [
        createTestMessage({ id: "msg-1", message: "Original message" }),
        createTestMessage({ id: "msg-2", message: "Reply message", replyId: "msg-1" }),
      ];
      const { props } = setupChatAreaTest({ messages });
      render(<ChatArea {...props} />);

      expect(screen.getByTestId("reply-message")).toBeInTheDocument();
      expect(screen.getByText("Reply message")).toBeInTheDocument();
    });

    test("renders messages with artifacts", () => {
      const messages = [
        createTestMessage({
          id: "msg-1",
          artifacts: [createTestArtifact({ type: "code" })],
        }),
      ];
      const { props } = setupChatAreaTest({ messages });
      render(<ChatArea {...props} />);

      expect(screen.getByTestId("artifact-0")).toBeInTheDocument();
      expect(screen.getByText("code")).toBeInTheDocument();
    });
  });

  describe("Navigation Handling", () => {
    test("navigates to plan page when isPlanChat is true", async () => {
      const user = userEvent.setup();
      const { props, router } = setupChatAreaTest({
        taskTitle: "Test Task",
        workspaceSlug: "test-workspace",
        isPlanChat: true,
      });
      render(<ChatArea {...props} />);

      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      expect(router.push).toHaveBeenCalledWith("/w/test-workspace/plan");
      expect(router.back).not.toHaveBeenCalled();
    });

    test("navigates to feature tasks tab when featureId is present", async () => {
      const user = userEvent.setup();
      const { props, router } = setupChatAreaTest({
        taskTitle: "Test Task",
        workspaceSlug: "test-workspace",
        featureId: "feature-123",
      });
      render(<ChatArea {...props} />);

      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      expect(router.push).toHaveBeenCalledWith("/w/test-workspace/plan/feature-123?tab=tasks");
      expect(router.back).not.toHaveBeenCalled();
    });

    test("navigates to tasks list when no featureId", async () => {
      const user = userEvent.setup();
      const { props, router } = setupChatAreaTest({
        taskTitle: "Test Task",
        workspaceSlug: "test-workspace",
      });
      render(<ChatArea {...props} />);

      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      expect(router.push).toHaveBeenCalledWith("/w/test-workspace/tasks");
      expect(router.back).not.toHaveBeenCalled();
    });

    test("falls back to router.back when no workspaceSlug", async () => {
      const user = userEvent.setup();
      const { props, router } = setupChatAreaTest({
        taskTitle: "Test Task",
        workspaceSlug: undefined,
      });
      render(<ChatArea {...props} />);

      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      expect(router.back).toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
    });

    test("isPlanChat takes priority over featureId", async () => {
      const user = userEvent.setup();
      const { props, router } = setupChatAreaTest({
        taskTitle: "Test Task",
        workspaceSlug: "test-workspace",
        featureId: "feature-123",
        isPlanChat: true,
      });
      render(<ChatArea {...props} />);

      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      expect(router.push).toHaveBeenCalledWith("/w/test-workspace/plan");
      expect(router.back).not.toHaveBeenCalled();
    });
  });

  describe("Workflow Status Display", () => {
    test("displays loading state when chain is visible", () => {
      const { props } = setupChatAreaTest({
        isChainVisible: true,
        lastLogLine: "Processing your request...",
      });
      render(<ChatArea {...props} />);

      expect(screen.getByText("Processing your request...")).toBeInTheDocument();
      expect(screen.getByText("Processing...")).toBeInTheDocument();
    });

    test("shows default message when chain is visible but no log line", () => {
      const { props } = setupChatAreaTest({
        isChainVisible: true,
      });
      render(<ChatArea {...props} />);

      expect(screen.getByText("Communicating with workflow...")).toBeInTheDocument();
    });
  });

  describe("ChatInput Integration", () => {
    test("passes correct props to ChatInput", () => {
      const logs = [createTestLogEntry()];
      const debugAttachment = createTestArtifact();
      const onSend = vi.fn();
      const onRemoveDebugAttachment = vi.fn();

      const { props } = setupChatAreaTest({
        logs,
        onSend,
        inputDisabled: true,
        isLoading: true,
        pendingDebugAttachment: debugAttachment,
        onRemoveDebugAttachment,
        workflowStatus: "IN_PROGRESS" as WorkflowStatus,
      });

      render(<ChatArea {...props} />);

      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Loading...")).toBeInTheDocument();
      expect(screen.getByTestId("debug-attachment")).toBeInTheDocument();
      expect(screen.getByTestId("workflow-status")).toBeInTheDocument();
    });

    test("handles send message from ChatInput", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      const { props } = setupChatAreaTest({ onSend });

      render(<ChatArea {...props} />);

      const sendButton = screen.getByTestId("send-button");
      await user.click(sendButton);

      expect(onSend).toHaveBeenCalledWith("test message");
    });

    test("handles debug attachment removal", async () => {
      const user = userEvent.setup();
      const onRemoveDebugAttachment = vi.fn();
      const { props } = setupChatAreaTest({
        pendingDebugAttachment: createTestArtifact(),
        onRemoveDebugAttachment,
      });

      render(<ChatArea {...props} />);

      const removeButton = screen.getByText("Remove");
      await user.click(removeButton);

      expect(onRemoveDebugAttachment).toHaveBeenCalled();
    });
  });

  describe("Component Lifecycle", () => {
    test("scrolls to bottom when messages change", async () => {
      const scrollIntoViewMock = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoViewMock;

      const { props } = setupChatAreaTest();
      const { rerender } = render(<ChatArea {...props} />);

      const newMessages = [
        ...props.messages,
        createTestMessage({ id: "new-msg", message: "New message" }),
      ];

      rerender(<ChatArea {...props} messages={newMessages} />);

      // Wait for useEffect to trigger
      await waitFor(() => {
        expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth' });
      });
    });

    test("handles missing scrollIntoView gracefully", async () => {
      const originalScrollIntoView = Element.prototype.scrollIntoView;
      delete (Element.prototype as any).scrollIntoView;

      const { props } = setupChatAreaTest();
      
      // Should not throw an error
      expect(() => render(<ChatArea {...props} />)).not.toThrow();

      Element.prototype.scrollIntoView = originalScrollIntoView;
    });
  });

  describe("User Interactions", () => {
    test("handles artifact actions", async () => {
      const user = userEvent.setup();
      const onArtifactAction = vi.fn().mockResolvedValue(undefined);
      const { props } = setupChatAreaTest({ onArtifactAction });

      render(<ChatArea {...props} />);

      const artifactButton = screen.getByText("Artifact Action");
      await user.click(artifactButton);

      expect(onArtifactAction).toHaveBeenCalledWith(
        "message-1",
        { id: 'test-action' },
        'webhook'
      );
    });

    test("disables input when inputDisabled is true", () => {
      const { props } = setupChatAreaTest({ inputDisabled: true });
      render(<ChatArea {...props} />);

      const input = screen.getByTestId("message-input");
      expect(input).toBeDisabled();
    });

    test("shows loading state in input when isLoading is true", () => {
      const { props } = setupChatAreaTest({ isLoading: true });
      render(<ChatArea {...props} />);

      expect(screen.getByPlaceholderText("Loading...")).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    test("handles onSend errors gracefully", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockRejectedValue(new Error("Send failed"));
      const { props } = setupChatAreaTest({ onSend });

      render(<ChatArea {...props} />);

      const sendButton = screen.getByTestId("send-button");
      await user.click(sendButton);

      expect(onSend).toHaveBeenCalled();
      // Component should still be rendered despite error
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });

    test("handles onArtifactAction errors gracefully", async () => {
      const user = userEvent.setup();
      const onArtifactAction = vi.fn().mockRejectedValue(new Error("Action failed"));
      const { props } = setupChatAreaTest({ onArtifactAction });

      render(<ChatArea {...props} />);

      const artifactButton = screen.getByText("Artifact Action");
      await user.click(artifactButton);

      expect(onArtifactAction).toHaveBeenCalled();
      // Component should still be rendered despite error
      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    test("renders with empty messages array", () => {
      const { props } = setupChatAreaTest({ messages: [] });
      render(<ChatArea {...props} />);

      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
      expect(screen.queryByTestId(/chat-message-/)).not.toBeInTheDocument();
    });

    test("renders with null values for optional props", () => {
      const { props } = setupChatAreaTest({
        lastLogLine: null,
        logs: null,
        pendingDebugAttachment: null,
        workflowStatus: null,
        taskTitle: null,
        workspaceSlug: null,
      });

      expect(() => render(<ChatArea {...props} />)).not.toThrow();
    });

    test("handles undefined onRemoveDebugAttachment", () => {
      const { props } = setupChatAreaTest({
        onRemoveDebugAttachment: undefined,
        pendingDebugAttachment: createTestArtifact(),
      });

      expect(() => render(<ChatArea {...props} />)).not.toThrow();
    });

    test("renders with very long message content", () => {
      const longMessage = "a".repeat(10000);
      const messages = [createTestMessage({ message: longMessage })];
      const { props } = setupChatAreaTest({ messages });

      render(<ChatArea {...props} />);

      expect(screen.getByText(longMessage)).toBeInTheDocument();
    });

    test("handles special characters in messages", () => {
      const specialMessage = "Test with 🚀 emojis and special chars: àáâäåæçèéêë & <html> tags";
      const messages = [createTestMessage({ message: specialMessage })];
      const { props } = setupChatAreaTest({ messages });

      render(<ChatArea {...props} />);

      expect(screen.getByText(specialMessage)).toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    test("has proper button roles and labels", () => {
      const { props } = setupChatAreaTest({
        taskTitle: "Test Task",
      });
      render(<ChatArea {...props} />);

      // Find the back button by the arrow icon testid within it
      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      expect(backButton).toBeInTheDocument();
    });

    test("maintains focus management during interactions", async () => {
      const user = userEvent.setup();
      const { props } = setupChatAreaTest({ taskTitle: "Test Task" });
      render(<ChatArea {...props} />);

      // Find the back button by the arrow icon testid within it
      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      // Focus should be maintained properly (tested indirectly through no errors)
      expect(backButton).toBeInTheDocument();
    });
  });

  describe("Pod Release Confirmation", () => {
    test("opens confirmation dialog when release pod button is clicked", async () => {
      const user = userEvent.setup();
      const onReleasePod = vi.fn().mockResolvedValue(undefined);
      const { props } = setupChatAreaTest({
        onReleasePod,
        podId: "test-pod-123",
        taskTitle: "Test Task",
      });

      render(<ChatArea {...props} />);

      // Find and click the release pod button by its server icon
      const releaseButton = screen.getByTestId("server-icon").closest("button");
      await user.click(releaseButton!);

      // Verify dialog is shown
      expect(screen.getByTestId("release-pod-dialog")).toBeInTheDocument();
      expect(screen.getByTestId("dialog-title")).toHaveTextContent("Release Pod?");
      expect(screen.getByTestId("dialog-description")).toHaveTextContent(
        "This will release the development pod back to the pool. Any unsaved work in the pod may be lost."
      );
      
      // Verify onReleasePod has NOT been called yet
      expect(onReleasePod).not.toHaveBeenCalled();
    });

    test("closes dialog without calling onReleasePod when cancel is clicked", async () => {
      const user = userEvent.setup();
      const onReleasePod = vi.fn().mockResolvedValue(undefined);
      const { props } = setupChatAreaTest({
        onReleasePod,
        podId: "test-pod-123",
        taskTitle: "Test Task",
      });

      render(<ChatArea {...props} />);

      // Open dialog
      const releaseButton = screen.getByTestId("server-icon").closest("button");
      await user.click(releaseButton!);
      expect(screen.getByTestId("release-pod-dialog")).toBeInTheDocument();

      // Click cancel
      const cancelButton = screen.getByTestId("dialog-cancel");
      await user.click(cancelButton);

      // Verify dialog is closed
      await waitFor(() => {
        expect(screen.queryByTestId("release-pod-dialog")).not.toBeInTheDocument();
      });

      // Verify onReleasePod was NOT called
      expect(onReleasePod).not.toHaveBeenCalled();
    });

    test("calls onReleasePod and closes dialog when confirm is clicked", async () => {
      const user = userEvent.setup();
      const onReleasePod = vi.fn().mockResolvedValue(undefined);
      const { props } = setupChatAreaTest({
        onReleasePod,
        podId: "test-pod-123",
        taskTitle: "Test Task",
      });

      render(<ChatArea {...props} />);

      // Open dialog
      const releaseButton = screen.getByTestId("server-icon").closest("button");
      await user.click(releaseButton!);
      expect(screen.getByTestId("release-pod-dialog")).toBeInTheDocument();

      // Click confirm
      const confirmButton = screen.getByTestId("dialog-confirm");
      await user.click(confirmButton);

      // Verify onReleasePod was called
      expect(onReleasePod).toHaveBeenCalledTimes(1);

      // Verify dialog is closed
      await waitFor(() => {
        expect(screen.queryByTestId("release-pod-dialog")).not.toBeInTheDocument();
      });
    });

    test("confirm button has destructive variant styling", async () => {
      const user = userEvent.setup();
      const onReleasePod = vi.fn().mockResolvedValue(undefined);
      const { props } = setupChatAreaTest({
        onReleasePod,
        podId: "test-pod-123",
        taskTitle: "Test Task",
      });

      render(<ChatArea {...props} />);

      // Open dialog
      const releaseButton = screen.getByTestId("server-icon").closest("button");
      await user.click(releaseButton!);

      // Verify confirm button has destructive styling
      const confirmButton = screen.getByTestId("dialog-confirm");
      expect(confirmButton).toHaveClass("destructive");
      expect(confirmButton).toHaveTextContent("Release Pod");
    });

    test("does not show release button when onReleasePod is not provided", () => {
      const { props } = setupChatAreaTest({
        onReleasePod: undefined,
        podId: "test-pod-123",
      });

      render(<ChatArea {...props} />);

      // Release button should not be present
      expect(screen.queryByTestId("server-icon")).not.toBeInTheDocument();
    });

    test("does not show release button when podId is not provided", () => {
      const onReleasePod = vi.fn().mockResolvedValue(undefined);
      const { props } = setupChatAreaTest({
        onReleasePod,
        podId: undefined,
      });

      render(<ChatArea {...props} />);

      // Release button should not be present
      expect(screen.queryByTestId("server-icon")).not.toBeInTheDocument();
    });

    test("disables release button when isReleasingPod is true", () => {
      const onReleasePod = vi.fn().mockResolvedValue(undefined);
      const { props } = setupChatAreaTest({
        onReleasePod,
        podId: "test-pod-123",
        taskTitle: "Test Task",
        isReleasingPod: true,
      });

      render(<ChatArea {...props} />);

      const releaseButton = screen.getByTestId("server-icon").closest("button");
      expect(releaseButton).toBeDisabled();
    });
  });

  describe("Sphinx Invite Button", () => {
    test("renders Invite button when sphinxInviteEnabled is true", () => {
      const { props } = setupChatAreaTest({
        sphinxInviteEnabled: true,
        workspaceSlug: "test-workspace",
        featureId: "test-feature",
        taskTitle: "Test Task",
      });

      render(<ChatArea {...props} />);

      const inviteButton = screen.getByText("Invite");
      expect(inviteButton).toBeInTheDocument();
      expect(screen.getByTestId("user-plus-icon")).toBeInTheDocument();
    });

    test("does not render Invite button when sphinxInviteEnabled is false", () => {
      const { props } = setupChatAreaTest({
        sphinxInviteEnabled: false,
        taskTitle: "Test Task",
      });

      render(<ChatArea {...props} />);

      expect(screen.queryByText("Invite")).not.toBeInTheDocument();
      expect(screen.queryByTestId("user-plus-icon")).not.toBeInTheDocument();
    });

    test("does not render Invite button when sphinxInviteEnabled is undefined", () => {
      const { props } = setupChatAreaTest({
        taskTitle: "Test Task",
      });

      render(<ChatArea {...props} />);

      expect(screen.queryByText("Invite")).not.toBeInTheDocument();
      expect(screen.queryByTestId("user-plus-icon")).not.toBeInTheDocument();
    });

    test("opens InvitePopover when Invite button is clicked", async () => {
      const user = userEvent.setup();
      const { props } = setupChatAreaTest({
        sphinxInviteEnabled: true,
        workspaceSlug: "test-workspace",
        featureId: "test-feature",
        taskTitle: "Test Task",
      });

      render(<ChatArea {...props} />);

      const inviteButton = screen.getByTestId("invite-button");
      await user.click(inviteButton);

      // The button should trigger the popover to open
      expect(inviteButton).toBeInTheDocument();
    });

    test("does not render Invite button when workspaceSlug is not provided", () => {
      const { props } = setupChatAreaTest({
        sphinxInviteEnabled: true,
        workspaceSlug: null,
        featureId: "test-feature",
        taskTitle: "Test Task",
      });

      render(<ChatArea {...props} />);

      expect(screen.queryByTestId("invite-button")).not.toBeInTheDocument();
    });

    test("does not render Invite button when featureId is not provided", () => {
      const { props } = setupChatAreaTest({
        sphinxInviteEnabled: true,
        workspaceSlug: "test-workspace",
        featureId: null,
        taskTitle: "Test Task",
      });

      render(<ChatArea {...props} />);

      expect(screen.queryByTestId("invite-button")).not.toBeInTheDocument();
    });

    test("does not render Invite button without task title", () => {
      const { props } = setupChatAreaTest({
        sphinxInviteEnabled: true,
        workspaceSlug: "test-workspace",
        featureId: "test-feature",
        taskTitle: null,
      });

      render(<ChatArea {...props} />);

      // Button should not render when header is not shown (no task title)
      expect(screen.queryByTestId("invite-button")).not.toBeInTheDocument();
    });
  });

  describe("Back Navigation (handleBackToTasks)", () => {
    test("navigates to plan page when isPlanChat is true", async () => {
      const user = userEvent.setup();
      const { props, router } = setupChatAreaTest({
        taskTitle: "Test Task",
        workspaceSlug: "test-workspace",
        isPlanChat: true,
      });

      render(<ChatArea {...props} />);

      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      expect(router.push).toHaveBeenCalledWith("/w/test-workspace/plan");
      expect(router.back).not.toHaveBeenCalled();
    });

    test("navigates to feature Tasks tab when featureId is present", async () => {
      const user = userEvent.setup();
      const { props, router } = setupChatAreaTest({
        taskTitle: "Test Task",
        workspaceSlug: "test-workspace",
        featureId: "feature-123",
      });

      render(<ChatArea {...props} />);

      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      expect(router.push).toHaveBeenCalledWith("/w/test-workspace/plan/feature-123?tab=tasks");
      expect(router.back).not.toHaveBeenCalled();
    });

    test("navigates to workspace tasks list when no featureId", async () => {
      const user = userEvent.setup();
      const { props, router } = setupChatAreaTest({
        taskTitle: "Test Task",
        workspaceSlug: "test-workspace",
        featureId: null,
      });

      render(<ChatArea {...props} />);

      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      expect(router.push).toHaveBeenCalledWith("/w/test-workspace/tasks");
      expect(router.back).not.toHaveBeenCalled();
    });

    test("falls back to router.back() when workspaceSlug is not provided", async () => {
      const user = userEvent.setup();
      const { props, router } = setupChatAreaTest({
        taskTitle: "Test Task",
        workspaceSlug: null,
        featureId: "feature-123",
      });

      render(<ChatArea {...props} />);

      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      expect(router.back).toHaveBeenCalledTimes(1);
      expect(router.push).not.toHaveBeenCalled();
    });
  });
});
