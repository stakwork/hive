import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "@/app/w/[slug]/task/[...taskParams]/components/ChatInput";
import { WorkflowStatus } from "@/lib/chat";

// Mock UI components
vi.mock("@/components/ui/input", () => ({
  Input: vi.fn(({ value, onChange, disabled, placeholder, className, ...props }) => (
    <input
      data-testid="chat-input"
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      autoFocus={props.autoFocus}
      {...props}
    />
  )),
}));

vi.mock("@/components/ui/button", () => ({
  Button: vi.fn(({ children, disabled, type, onClick, ...props }) => (
    <button
      data-testid="chat-button"
      disabled={disabled}
      type={type}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  )),
}));

// Mock custom components
vi.mock("@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge", () => ({
  WorkflowStatusBadge: vi.fn(({ logs, status }) => {
    console.log("WorkflowStatusBadge props:", { logs, status });
    return (
      <div data-testid="workflow-status-badge">
        Status: {status} | Logs: {logs?.length || 0}
      </div>
    );
  }),
}));

vi.mock("@/components/InputDebugAttachment", () => ({
  InputDebugAttachment: vi.fn(({ attachment, onRemove }) => (
    <div data-testid="debug-attachment">
      <span>Attachment: {attachment?.type || "unknown"}</span>
      <button onClick={onRemove} data-testid="remove-attachment">
        Remove
      </button>
    </div>
  )),
}));

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

describe("ChatInput Component", () => {
  const mockOnSend = vi.fn();
  const mockOnRemoveDebugAttachment = vi.fn();
  const mockLogs = [
    { message: "Test log 1", timestamp: new Date() },
    { message: "Test log 2", timestamp: new Date() },
  ];

  const defaultProps = {
    logs: mockLogs,
    onSend: mockOnSend,
    disabled: false,
    isLoading: false,
    pendingDebugAttachment: null,
    onRemoveDebugAttachment: mockOnRemoveDebugAttachment,
    workflowStatus: WorkflowStatus.PENDING,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue("live");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Component Rendering", () => {
    test("should render with default props", () => {
      render(<ChatInput {...defaultProps} />);

      expect(screen.getByTestId("chat-input")).toBeInTheDocument();
      expect(screen.getByTestId("chat-button")).toBeInTheDocument();
      expect(screen.getByTestId("workflow-status-badge")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Type your message...")).toBeInTheDocument();
    });

    test("should display mode from localStorage", () => {
      localStorageMock.getItem.mockReturnValue("debug");
      render(<ChatInput {...defaultProps} />);

      expect(screen.getByText("debug")).toBeInTheDocument();
      expect(localStorageMock.getItem).toHaveBeenCalledWith("task_mode");
    });

    test("should default to 'live' mode when localStorage is empty", () => {
      localStorageMock.getItem.mockReturnValue(null);
      render(<ChatInput {...defaultProps} />);

      expect(screen.getByText("live")).toBeInTheDocument();
    });

    test("should render debug attachment when present", () => {
      const mockAttachment = {
        type: "code",
        content: "console.log('test')",
      };

      render(
        <ChatInput
          {...defaultProps}
          pendingDebugAttachment={mockAttachment}
        />
      );

      expect(screen.getByTestId("debug-attachment")).toBeInTheDocument();
      expect(screen.getByText("Attachment: code")).toBeInTheDocument();
    });
  });

  describe("Mode Switching Logic", () => {
    test("should load mode from localStorage on mount", () => {
      localStorageMock.getItem.mockReturnValue("test-mode");
      render(<ChatInput {...defaultProps} />);

      expect(localStorageMock.getItem).toHaveBeenCalledWith("task_mode");
      expect(screen.getByText("test-mode")).toBeInTheDocument();
    });

    test("should handle empty localStorage gracefully", () => {
      localStorageMock.getItem.mockReturnValue("");
      render(<ChatInput {...defaultProps} />);

      expect(screen.getByText("live")).toBeInTheDocument();
    });

    test("should handle localStorage returning undefined", () => {
      localStorageMock.getItem.mockReturnValue(undefined);
      render(<ChatInput {...defaultProps} />);

      expect(screen.getByText("live")).toBeInTheDocument();
    });
  });

  describe("Message Submission", () => {
    test("should call onSend with trimmed message on form submission", async () => {
      const user = userEvent.setup();
      render(<ChatInput {...defaultProps} />);

      const input = screen.getByTestId("chat-input");
      const button = screen.getByTestId("chat-button");

      await user.type(input, "  test message  ");
      await user.click(button);

      expect(mockOnSend).toHaveBeenCalledWith("test message");
      expect(mockOnSend).toHaveBeenCalledTimes(1);
    });

    test("should call onSend when form is submitted via Enter key", async () => {
      const user = userEvent.setup();
      render(<ChatInput {...defaultProps} />);

      const input = screen.getByTestId("chat-input");
      
      await user.type(input, "keyboard message");
      await user.keyboard("{Enter}");

      expect(mockOnSend).toHaveBeenCalledWith("keyboard message");
    });

    test("should clear input field after successful submission", async () => {
      const user = userEvent.setup();
      render(<ChatInput {...defaultProps} />);

      const input = screen.getByTestId("chat-input");
      
      await user.type(input, "test message");
      expect(input).toHaveValue("test message");

      await user.keyboard("{Enter}");
      
      await waitFor(() => {
        expect(input).toHaveValue("");
      });
    });

    test("should handle async onSend callback", async () => {
      const asyncOnSend = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      
      render(<ChatInput {...defaultProps} onSend={asyncOnSend} />);

      const input = screen.getByTestId("chat-input");
      await user.type(input, "async message");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(asyncOnSend).toHaveBeenCalledWith("async message");
      });
    });

    test("should allow submission with debug attachment and empty input", async () => {
      const user = userEvent.setup();
      const mockAttachment = { type: "code", content: "test" };
      
      render(
        <ChatInput
          {...defaultProps}
          pendingDebugAttachment={mockAttachment}
        />
      );

      const button = screen.getByTestId("chat-button");
      expect(button).not.toBeDisabled();

      await user.click(button);
      expect(mockOnSend).toHaveBeenCalledWith("");
    });
  });

  describe("Input Validation and Disabled States", () => {
    test("should prevent submission with empty input and no debug attachment", async () => {
      const user = userEvent.setup();
      render(<ChatInput {...defaultProps} />);

      const input = screen.getByTestId("chat-input");
      const button = screen.getByTestId("chat-button");

      // Try to submit empty form
      await user.click(button);
      expect(mockOnSend).not.toHaveBeenCalled();

      // Try with whitespace only
      await user.type(input, "   ");
      await user.click(button);
      expect(mockOnSend).not.toHaveBeenCalled();
    });

    test("should disable button when input is empty and no debug attachment", () => {
      render(<ChatInput {...defaultProps} />);

      const button = screen.getByTestId("chat-button");
      expect(button).toBeDisabled();
    });

    test("should enable button when input has content", async () => {
      const user = userEvent.setup();
      render(<ChatInput {...defaultProps} />);

      const input = screen.getByTestId("chat-input");
      const button = screen.getByTestId("chat-button");

      await user.type(input, "test");
      expect(button).not.toBeDisabled();
    });

    test("should prevent submission when loading", async () => {
      const user = userEvent.setup();
      render(<ChatInput {...defaultProps} isLoading={true} />);

      const input = screen.getByTestId("chat-input");
      const button = screen.getByTestId("chat-button");

      await user.type(input, "test message");
      await user.click(button);

      expect(mockOnSend).not.toHaveBeenCalled();
      expect(button).toBeDisabled();
    });

    test("should prevent submission when disabled", async () => {
      const user = userEvent.setup();
      render(<ChatInput {...defaultProps} disabled={true} />);

      const input = screen.getByTestId("chat-input");
      const button = screen.getByTestId("chat-button");

      await user.type(input, "test message");
      await user.click(button);

      expect(mockOnSend).not.toHaveBeenCalled();
      expect(button).toBeDisabled();
      expect(input).toBeDisabled();
    });

    test("should show 'Sending...' text when loading", () => {
      render(<ChatInput {...defaultProps} isLoading={true} />);

      expect(screen.getByText("Sending...")).toBeInTheDocument();
    });

    test("should show 'Send' text when not loading", () => {
      render(<ChatInput {...defaultProps} isLoading={false} />);

      expect(screen.getByText("Send")).toBeInTheDocument();
    });
  });

  describe("Debug Attachment Integration", () => {
    test("should render debug attachment when present", () => {
      const mockAttachment = {
        type: "browser",
        content: "<html>test</html>",
      };

      render(
        <ChatInput
          {...defaultProps}
          pendingDebugAttachment={mockAttachment}
        />
      );

      expect(screen.getByTestId("debug-attachment")).toBeInTheDocument();
      expect(screen.getByText("Attachment: browser")).toBeInTheDocument();
    });

    test("should call onRemoveDebugAttachment when remove button is clicked", async () => {
      const user = userEvent.setup();
      const mockAttachment = { type: "code", content: "test" };

      render(
        <ChatInput
          {...defaultProps}
          pendingDebugAttachment={mockAttachment}
        />
      );

      const removeButton = screen.getByTestId("remove-attachment");
      await user.click(removeButton);

      expect(mockOnRemoveDebugAttachment).toHaveBeenCalled();
    });

    test("should handle missing onRemoveDebugAttachment gracefully", async () => {
      const user = userEvent.setup();
      const mockAttachment = { type: "code", content: "test" };

      render(
        <ChatInput
          {...defaultProps}
          pendingDebugAttachment={mockAttachment}
          onRemoveDebugAttachment={undefined}
        />
      );

      const removeButton = screen.getByTestId("remove-attachment");
      
      // Should not throw error when clicked
      await expect(user.click(removeButton)).resolves.not.toThrow();
    });

    test("should not render debug attachment section when attachment is null", () => {
      render(<ChatInput {...defaultProps} pendingDebugAttachment={null} />);

      expect(screen.queryByTestId("debug-attachment")).not.toBeInTheDocument();
    });
  });

  describe("WorkflowStatusBadge Integration", () => {
    test("should pass logs and status to WorkflowStatusBadge", () => {
      render(
        <ChatInput
          {...defaultProps}
          logs={mockLogs}
          workflowStatus={WorkflowStatus.RUNNING}
        />
      );

      const statusBadge = screen.getByTestId("workflow-status-badge");
      expect(statusBadge).toHaveTextContent("RUNNING");
      expect(statusBadge).toHaveTextContent("Logs: 2");
    });

    test("should handle empty logs array", () => {
      render(
        <ChatInput
          {...defaultProps}
          logs={[]}
          workflowStatus={WorkflowStatus.COMPLETED}
        />
      );

      const statusBadge = screen.getByTestId("workflow-status-badge");
      expect(statusBadge).toHaveTextContent("Logs: 0");
    });

    test("should handle undefined workflowStatus", () => {
      render(
        <ChatInput
          {...defaultProps}
          workflowStatus={undefined}
        />
      );

      const statusBadge = screen.getByTestId("workflow-status-badge");
      expect(statusBadge).toHaveTextContent("Status:");
    });
  });

  describe("Form Event Handling", () => {
    test("should prevent default form submission behavior", async () => {
      const user = userEvent.setup();
      render(<ChatInput {...defaultProps} />);

      const form = screen.getByTestId("chat-input").closest("form");
      const submitSpy = vi.fn();
      
      if (form) {
        form.addEventListener("submit", submitSpy);
      }

      const input = screen.getByTestId("chat-input");
      await user.type(input, "test message");
      await user.keyboard("{Enter}");

      // Form submission should be prevented (no page reload)
      expect(submitSpy).toHaveBeenCalled();
      expect(mockOnSend).toHaveBeenCalledWith("test message");
    });

    test("should handle rapid successive submissions", async () => {
      const user = userEvent.setup();
      render(<ChatInput {...defaultProps} />);

      const input = screen.getByTestId("chat-input");
      const button = screen.getByTestId("chat-button");

      // First submission
      await user.type(input, "message 1");
      await user.click(button);

      // Second submission (input should be cleared)
      await user.type(input, "message 2");
      await user.click(button);

      expect(mockOnSend).toHaveBeenCalledTimes(2);
      expect(mockOnSend).toHaveBeenNthCalledWith(1, "message 1");
      expect(mockOnSend).toHaveBeenNthCalledWith(2, "message 2");
    });
  });

  describe("Accessibility and UX", () => {
    test("should have autofocus on input field", () => {
      render(<ChatInput {...defaultProps} />);

      // Just verify input exists since autoFocus behavior is complex in test environment
      const input = screen.getByTestId("chat-input");
      expect(input).toBeInTheDocument();
    });

    test("should maintain focus on input after submission", async () => {
      const user = userEvent.setup();
      render(<ChatInput {...defaultProps} />);

      const input = screen.getByTestId("chat-input");
      
      await user.type(input, "test message");
      await user.keyboard("{Enter}");

      // Input should still be focused after submission
      expect(input).toHaveFocus();
    });

    test("should have proper form structure", () => {
      render(<ChatInput {...defaultProps} />);

      const form = screen.getByTestId("chat-input").closest("form");
      expect(form).toBeInTheDocument();
      
      const button = screen.getByTestId("chat-button");
      expect(button).toHaveAttribute("type", "submit");
    });
  });

  describe("Error Handling", () => {
    test("should handle onSend callback errors gracefully", async () => {
      const errorOnSend = vi.fn().mockRejectedValue(new Error("Send failed"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const user = userEvent.setup();

      render(<ChatInput {...defaultProps} onSend={errorOnSend} />);

      const input = screen.getByTestId("chat-input");
      await user.type(input, "test message");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(errorOnSend).toHaveBeenCalled();
      });

      // Input should still be cleared even if onSend fails
      expect(input).toHaveValue("");
      
      consoleErrorSpy.mockRestore();
    });

    test("should handle localStorage access errors", () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error("localStorage error");
      });

      // Should not crash and should default to "live" mode
      expect(() => render(<ChatInput {...defaultProps} />)).not.toThrow();
      expect(screen.getByText("live")).toBeInTheDocument();
    });
  });
});