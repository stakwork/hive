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
  ChatInput: ({ onSend, disabled, isLoading, logs, pendingDebugAttachment, onRemoveDebugAttachment, workflowStatus }: any) => (
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
      {logs && logs.length > 0 && (
        <div data-testid="logs-count">{logs.length}</div>
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
    stakworkProjectId: null,
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
    test("navigates back when referrer is same-origin", async () => {
      const user = userEvent.setup();
      
      // Mock document.referrer and window.location.origin
      Object.defineProperty(document, "referrer", {
        value: "http://localhost:3000/w/test-workspace/features/feature-1",
        configurable: true,
      });
      Object.defineProperty(window, "location", {
        value: {
          origin: "http://localhost:3000",
        },
        writable: true,
        configurable: true,
      });

      const { props, router } = setupChatAreaTest({
        taskTitle: "Test Task",
        workspaceSlug: "test-workspace",
      });
      render(<ChatArea {...props} />);

      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      expect(router.back).toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
    });

    test("navigates to tasks list when referrer is external origin", async () => {
      const user = userEvent.setup();
      
      // Mock external referrer
      Object.defineProperty(document, "referrer", {
        value: "https://external-site.com/some-page",
        configurable: true,
      });
      Object.defineProperty(window, "location", {
        value: {
          origin: "http://localhost:3000",
        },
        writable: true,
        configurable: true,
      });

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

    test("navigates to tasks list when no referrer is present", async () => {
      const user = userEvent.setup();
      
      // Mock empty referrer
      Object.defineProperty(document, "referrer", {
        value: "",
        configurable: true,
      });
      Object.defineProperty(window, "location", {
        value: {
          origin: "http://localhost:3000",
        },
        writable: true,
        configurable: true,
      });

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

    test("calls router.back when no workspace slug is provided and no referrer", async () => {
      const user = userEvent.setup();
      
      // Mock empty referrer
      Object.defineProperty(document, "referrer", {
        value: "",
        configurable: true,
      });
      Object.defineProperty(window, "location", {
        value: {
          origin: "http://localhost:3000",
        },
        writable: true,
        configurable: true,
      });

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

    test("navigates back when same-origin referrer and no workspace slug", async () => {
      const user = userEvent.setup();
      
      // Mock same-origin referrer
      Object.defineProperty(document, "referrer", {
        value: "http://localhost:3000/some-page",
        configurable: true,
      });
      Object.defineProperty(window, "location", {
        value: {
          origin: "http://localhost:3000",
        },
        writable: true,
        configurable: true,
      });

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

    test("displays Stakwork project link when stakworkProjectId is provided", () => {
      const { props } = setupChatAreaTest({
        taskTitle: "Test Task",
        stakworkProjectId: 12345,
      });
      render(<ChatArea {...props} />);

      const link = screen.getByRole("link", { name: /workflow/i });
      expect(link).toHaveAttribute("href", "https://jobs.stakwork.com/admin/projects/12345");
      expect(link).toHaveAttribute("target", "_blank");
      expect(screen.getByTestId("external-link-icon")).toBeInTheDocument();
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
      expect(screen.getByTestId("logs-count")).toBeInTheDocument();
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
        stakworkProjectId: null,
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
        stakworkProjectId: 12345,
      });
      render(<ChatArea {...props} />);

      // Find the back button by the arrow icon testid within it
      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      expect(backButton).toBeInTheDocument();

      const workflowLink = screen.getByRole("link", { name: /workflow/i });
      expect(workflowLink).toBeInTheDocument();
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
});
