import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentChatArea } from "@/app/w/[slug]/task/[...taskParams]/components/AgentChatArea";
import type { ChatMessage, LogEntry, Artifact, WorkflowStatus } from "@/types/chat";
import { useRouter } from "next/navigation";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: (_target, prop) => {
        return ({ children, ...props }: any) => {
          const { layout, ...rest } = props;
          return React.createElement(prop as string, rest, children);
        };
      },
    }
  ),
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock ChatMessage component
vi.mock("@/components/chat/ChatMessage", () => {
  const React = require("react");
  return {
    ChatMessage: ({ message, onArtifactAction }: any) => (
      <div data-testid={`chat-message-${message.id}`}>
        <p>{message.message}</p>
        {message.artifacts && message.artifacts.length > 0 && (
          <div>
            {message.artifacts.map((artifact: any, index: number) => (
              <div key={index} data-testid={`artifact-${index}`}>
                <span>{artifact.type}</span>
              </div>
            ))}
          </div>
        )}
        {message.replyId && (
          <div data-testid="reply-message">
            <p>{message.message}</p>
          </div>
        )}
        <button onClick={() => onArtifactAction(message.id, { id: 'test-action' }, 'webhook')}>
          Artifact Action
        </button>
      </div>
    ),
  };
});

// Mock AgentChatMessage component
vi.mock("@/app/w/[slug]/task/[...taskParams]/components/AgentChatMessage", () => {
  const React = require("react");
  return {
    AgentChatMessage: ({ message }: any) => (
      <div data-testid={`agent-chat-message-${message.id}`}>
        <p>{message.message}</p>
      </div>
    ),
  };
});

// Mock ChatInput component (used by AgentChatArea)
vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ChatInput", () => {
  const React = require("react");
  return {
    ChatInput: ({ 
      onSend, 
      disabled, 
      isLoading, 
      logs, 
      pendingDebugAttachment, 
      onRemoveDebugAttachment,
      workflowStatus,
    }: any) => (
      <div data-testid="agent-chat-input">
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
  };
});

// Mock TaskBreadcrumbs component
vi.mock("@/app/w/[slug]/task/[...taskParams]/components/TaskBreadcrumbs", () => {
  const React = require("react");
  return {
    default: ({ featureId, featureTitle }: any) => (
      <div data-testid="task-breadcrumbs">
        {featureId && <span>{featureTitle}</span>}
      </div>
    ),
  };
});

// Mock ThinkingIndicator component
vi.mock("@/components/ThinkingIndicator", () => {
  const React = require("react");
  return {
    ThinkingIndicator: () => <div data-testid="thinking-indicator">Thinking...</div>,
  };
});

// Mock UI components
vi.mock("@/components/ui/button", () => {
  const React = require("react");
  return {
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
  };
});

vi.mock("@/components/ui/confirm-dialog", () => {
  const React = require("react");
  return {
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
  };
});

vi.mock("@/components/ui/tooltip", () => {
  const React = require("react");
  return {
    TooltipProvider: ({ children }: any) => <>{children}</>,
    Tooltip: ({ children }: any) => <>{children}</>,
    TooltipTrigger: ({ children, asChild }: any) => <>{children}</>,
    TooltipContent: ({ children }: any) => <div>{children}</div>,
  };
});

vi.mock("next/link", () => {
  const React = require("react");
  return {
    default: ({ children, href, ...props }: any) => (
      <a href={href} {...props}>{children}</a>
    ),
  };
});

// Mock icons
vi.mock("lucide-react", () => {
  const React = require("react");
  return {
    ArrowLeft: () => <span data-testid="arrow-left-icon">←</span>,
    ExternalLink: () => <span data-testid="external-link-icon">↗</span>,
    Monitor: () => <span data-testid="monitor-icon">🖥</span>,
    Server: (props: any) => <span data-testid="server-icon" {...props}>🖥️</span>,
    ServerOff: (props: any) => <span data-testid="server-off-icon" {...props}>⚠️</span>,
    GitCommit: () => <span data-testid="git-commit-icon">📝</span>,
    Clock: () => <span data-testid="clock-icon">🕐</span>,
    Github: () => <span data-testid="github-icon">🐙</span>,
    Loader2: () => <span data-testid="loader-icon">⏳</span>,
    CheckCircle: () => <span data-testid="check-circle-icon">✓</span>,
    AlertCircle: () => <span data-testid="alert-circle-icon">⚠</span>,
    Pause: () => <span data-testid="pause-icon">⏸</span>,
    XCircle: () => <span data-testid="x-circle-icon">✗</span>,
    Zap: () => <span data-testid="zap-icon">⚡</span>,
    Bot: () => <span data-testid="bot-icon">🤖</span>,
    Globe: () => <span data-testid="globe-icon">🌐</span>,
    RefreshCw: () => <span data-testid="refresh-icon">🔄</span>,
    GitBranch: () => <span data-testid="git-branch-icon">🌿</span>,
    X: () => <span data-testid="x-icon">✕</span>,
    Workflow: () => <span data-testid="workflow-icon">🔄</span>,
  };
});

// Mock useIsMobile hook
vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

// Mock cn utility
vi.mock("@/lib/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

vi.mock("@/lib/icons", () => {
  const React = require("react");
  return {
    getAgentIcon: () => <span data-testid="agent-icon">🤖</span>,
  };
});

// Test data factories
const TestDataFactories = {
  message: (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
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

  agentChatAreaProps: (props: Partial<any> = {}) => ({
    messages: [TestDataFactories.message()],
    onSend: vi.fn().mockResolvedValue(undefined),
    inputDisabled: false,
    isLoading: false,
    logs: [],
    pendingDebugAttachment: null,
    onRemoveDebugAttachment: vi.fn(),
    workflowStatus: null,
    taskTitle: null,
    workspaceSlug: null,
    onCommit: undefined,
    isCommitting: false,
    showPreviewToggle: false,
    showPreview: false,
    onTogglePreview: undefined,
    taskMode: "agent",
    podId: null,
    onReleasePod: undefined,
    isReleasingPod: false,
    prUrl: null,
    featureId: null,
    featureTitle: null,
    onOpenBountyRequest: undefined,
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

// Helper functions
const createTestMessage = TestDataFactories.message;
const createTestLogEntry = TestDataFactories.logEntry;
const createTestArtifact = TestDataFactories.artifact;

const setupAgentChatAreaTest = (props: Partial<any> = {}) => {
  const defaultProps = TestDataFactories.agentChatAreaProps(props);
  const mockRouter = TestDataFactories.mockRouter();
  (useRouter as any).mockReturnValue(mockRouter);
  return { props: defaultProps, router: mockRouter };
};

describe("AgentChatArea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Rendering", () => {
    test("renders agent chat area with messages", () => {
      const { props } = setupAgentChatAreaTest();
      render(<AgentChatArea {...props} />);

      expect(screen.getByTestId("agent-chat-message-message-1")).toBeInTheDocument();
      expect(screen.getByText("Test message content")).toBeInTheDocument();
      expect(screen.getByTestId("agent-chat-input")).toBeInTheDocument();
    });

    test("renders with task title header when taskTitle is provided", () => {
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Agent Task Title",
      });
      render(<AgentChatArea {...props} />);

      expect(screen.getByText("Agent Task Title")).toBeInTheDocument();
    });

    test("renders github button when onCommit and prUrl are provided", () => {
      const onCommit = vi.fn().mockResolvedValue(undefined);
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        onCommit,
        prUrl: "https://github.com/test/repo/pull/1",
      });
      render(<AgentChatArea {...props} />);

      expect(screen.getByText("Open PR")).toBeInTheDocument();
    });
  });

  describe("Message Rendering", () => {
    test("renders multiple messages", () => {
      const messages = [
        createTestMessage({ id: "msg-1", message: "First message" }),
        createTestMessage({ id: "msg-2", message: "Second message" }),
      ];
      const { props } = setupAgentChatAreaTest({ messages });
      render(<AgentChatArea {...props} />);

      expect(screen.getByText("First message")).toBeInTheDocument();
      expect(screen.getByText("Second message")).toBeInTheDocument();
    });
  });

  describe("Pod Release Confirmation", () => {
    test("opens confirmation dialog when release pod button is clicked", async () => {
      const user = userEvent.setup();
      const onReleasePod = vi.fn().mockResolvedValue(undefined);
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        onReleasePod,
        podId: "test-pod-123",
      });

      render(<AgentChatArea {...props} />);

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
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        onReleasePod,
        podId: "test-pod-123",
      });

      render(<AgentChatArea {...props} />);

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
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        onReleasePod,
        podId: "test-pod-123",
      });

      render(<AgentChatArea {...props} />);

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
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        onReleasePod,
        podId: "test-pod-123",
      });

      render(<AgentChatArea {...props} />);

      // Open dialog
      const releaseButton = screen.getByTestId("server-icon").closest("button");
      await user.click(releaseButton!);

      // Verify confirm button has destructive styling
      const confirmButton = screen.getByTestId("dialog-confirm");
      expect(confirmButton).toHaveClass("destructive");
      expect(confirmButton).toHaveTextContent("Release Pod");
    });

    test("does not show release button when onReleasePod is not provided", () => {
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        onReleasePod: undefined,
        podId: "test-pod-123",
      });

      render(<AgentChatArea {...props} />);

      // Release button should not be present
      expect(screen.queryByTestId("server-icon")).not.toBeInTheDocument();
    });

    test("does not show release button when podId is not provided", () => {
      const onReleasePod = vi.fn().mockResolvedValue(undefined);
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        onReleasePod,
        podId: undefined,
      });

      render(<AgentChatArea {...props} />);

      // Release button should not be present
      expect(screen.queryByTestId("server-icon")).not.toBeInTheDocument();
    });

    test("disables release button when isReleasingPod is true", () => {
      const onReleasePod = vi.fn().mockResolvedValue(undefined);
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        onReleasePod,
        podId: "test-pod-123",
        isReleasingPod: true,
      });

      render(<AgentChatArea {...props} />);

      const releaseButton = screen.getByTestId("server-icon").closest("button");
      expect(releaseButton).toBeDisabled();
    });
  });

  describe("Agent-Specific Features", () => {
    test("displays Create PR button when onCommit is provided without prUrl", () => {
      const onCommit = vi.fn().mockResolvedValue(undefined);
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        onCommit,
        prUrl: null,
      });

      render(<AgentChatArea {...props} />);

      expect(screen.getByText("Create PR")).toBeInTheDocument();
    });

    test("displays Open PR button when both onCommit and prUrl are provided", () => {
      const onCommit = vi.fn().mockResolvedValue(undefined);
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        onCommit,
        prUrl: "https://github.com/test/repo/pull/1",
      });

      render(<AgentChatArea {...props} />);

      expect(screen.getByText("Open PR")).toBeInTheDocument();
    });

    test("displays preview toggle when showPreviewToggle is true", () => {
      const onTogglePreview = vi.fn();
      const { props } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        showPreviewToggle: true,
        onTogglePreview,
      });

      render(<AgentChatArea {...props} />);

      expect(screen.getByTestId("monitor-icon")).toBeInTheDocument();
    });
  });

  describe("Navigation Handling", () => {
    test("navigates back when back button is clicked", async () => {
      const user = userEvent.setup();

      const { props, router } = setupAgentChatAreaTest({
        taskTitle: "Test Task",
        workspaceSlug: "test-workspace",
      });
      render(<AgentChatArea {...props} />);

      const backButton = screen.getByTestId("arrow-left-icon").closest("button");
      await user.click(backButton!);

      expect(router.push).toHaveBeenCalledWith("/w/test-workspace/tasks");
    });
  });

  describe("Input Handling", () => {
    test("handles send message from AgentChatInput", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      const { props } = setupAgentChatAreaTest({ onSend });

      render(<AgentChatArea {...props} />);

      const sendButton = screen.getByTestId("send-button");
      await user.click(sendButton);

      expect(onSend).toHaveBeenCalledWith("test message");
    });

    test("disables input when inputDisabled is true", () => {
      const { props } = setupAgentChatAreaTest({ inputDisabled: true });
      render(<AgentChatArea {...props} />);

      const input = screen.getByTestId("message-input");
      expect(input).toBeDisabled();
    });
  });

  describe("Edge Cases", () => {
    test("renders with empty messages array", () => {
      const { props } = setupAgentChatAreaTest({ messages: [] });
      render(<AgentChatArea {...props} />);

      expect(screen.getByTestId("agent-chat-input")).toBeInTheDocument();
      expect(screen.queryByTestId(/chat-message-/)).not.toBeInTheDocument();
    });

    test("renders with null values for optional props", () => {
      const { props } = setupAgentChatAreaTest({
        logs: null,
        pendingDebugAttachment: null,
        workflowStatus: null,
        taskTitle: null,
        workspaceSlug: null,
        prUrl: null,
        featureId: null,
        featureTitle: null,
      });

      expect(() => render(<AgentChatArea {...props} />)).not.toThrow();
    });
  });
});
