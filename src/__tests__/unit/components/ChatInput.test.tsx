import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatInput } from "@/app/w/[slug]/task/[...taskParams]/components/ChatInput";
import { WorkflowStatus } from "@/lib/chat";

// Mock dependencies
vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: "",
    isSupported: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    resetTranscript: vi.fn(),
  }),
}));

vi.mock("@/hooks/useControlKeyHold", () => ({
  useControlKeyHold: vi.fn(),
}));

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false, // Mock as desktop for tests
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(" "),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: React.forwardRef<HTMLTextAreaElement, any>(({ onKeyDown, ...props }, ref) => (
    <textarea ref={ref} onKeyDown={onKeyDown} {...props} />
  )),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, type, disabled, ...props }: any) => (
    <button onClick={onClick} type={type} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <div>{children}</div>,
  Tooltip: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children, asChild }: any) => <div>{children}</div>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge", () => ({
  WorkflowStatusBadge: () => <div data-testid="workflow-status-badge">Status</div>,
}));

vi.mock("@/components/InputDebugAttachment", () => ({
  InputDebugAttachment: ({ onRemove }: any) => (
    <div data-testid="debug-attachment">
      <button onClick={onRemove}>Remove</button>
    </div>
  ),
}));

describe("ChatInput - Task Mode", () => {
  const defaultProps = {
    logs: [],
    onSend: vi.fn().mockResolvedValue(undefined),
    disabled: false,
    isLoading: false,
    pendingDebugAttachment: null,
    onRemoveDebugAttachment: vi.fn(),
    workflowStatus: null as WorkflowStatus | null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock localStorage
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: vi.fn(() => "live"),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });
  });

  describe("Keyboard Interactions", () => {
    test("submits message when Enter is pressed without Shift", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByTestId("chat-message-input");
      
      await user.type(textarea, "Hello world");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("Hello world", undefined);
      expect(textarea).toHaveValue("");
    });

    test("does NOT submit message when Shift+Enter is pressed", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByTestId("chat-message-input");
      
      await user.type(textarea, "Line 1");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "Line 2");

      expect(onSend).not.toHaveBeenCalled();
      // Textarea should contain both lines (with newline character)
      expect(textarea).toHaveValue("Line 1\nLine 2");
    });

    test("allows multiple lines with multiple Shift+Enter presses", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByTestId("chat-message-input");
      
      await user.type(textarea, "Line 1");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "Line 2");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "Line 3");

      expect(onSend).not.toHaveBeenCalled();
      expect(textarea).toHaveValue("Line 1\nLine 2\nLine 3");
    });

    test("submits multi-line message with Enter after Shift+Enter", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByTestId("chat-message-input");
      
      await user.type(textarea, "Line 1");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "Line 2");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("Line 1\nLine 2", undefined);
      expect(textarea).toHaveValue("");
    });

    test("does not submit when Enter is pressed on empty input", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByTestId("chat-message-input");
      await user.click(textarea);
      await user.keyboard("{Enter}");

      expect(onSend).not.toHaveBeenCalled();
    });

    test("does not submit when Enter is pressed on whitespace-only input", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByTestId("chat-message-input");
      await user.type(textarea, "   ");
      await user.keyboard("{Enter}");

      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe("Basic Rendering", () => {
    test("renders textarea with correct placeholder", () => {
      render(<ChatInput {...defaultProps} />);
      
      expect(screen.getByPlaceholderText("Type your message...")).toBeInTheDocument();
    });

    test("renders send button", () => {
      render(<ChatInput {...defaultProps} />);
      
      expect(screen.getByText("Send")).toBeInTheDocument();
    });

    test("renders workflow status badge", () => {
      render(<ChatInput {...defaultProps} />);
      
      expect(screen.getByTestId("workflow-status-badge")).toBeInTheDocument();
    });
  });

  describe("Form Submission", () => {
    test("submits message via Send button", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByTestId("chat-message-input");
      const sendButton = screen.getByText("Send");
      
      await user.type(textarea, "Test message");
      await user.click(sendButton);

      expect(onSend).toHaveBeenCalledWith("Test message", undefined);
    });

    test("trims whitespace from submitted message", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByTestId("chat-message-input");
      
      await user.type(textarea, "  Message with spaces  ");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("Message with spaces", undefined);
    });

    test("clears textarea after successful submission", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByTestId("chat-message-input");
      
      await user.type(textarea, "Test message");
      await user.keyboard("{Enter}");

      expect(textarea).toHaveValue("");
    });
  });

  describe("Disabled States", () => {
    test("disables textarea when disabled prop is true", () => {
      render(<ChatInput {...defaultProps} disabled={true} />);
      
      const textarea = screen.getByTestId("chat-message-input");
      expect(textarea).toBeDisabled();
    });

    test("disables send button when disabled prop is true", () => {
      render(<ChatInput {...defaultProps} disabled={true} />);
      
      const sendButton = screen.getByText("Send");
      expect(sendButton).toBeDisabled();
    });

    test("disables send button when loading", () => {
      render(<ChatInput {...defaultProps} isLoading={true} />);
      
      const sendButton = screen.getByText("Sending...");
      expect(sendButton).toBeDisabled();
    });

    test("disables send button when textarea is empty", () => {
      render(<ChatInput {...defaultProps} />);
      
      const sendButton = screen.getByText("Send");
      expect(sendButton).toBeDisabled();
    });

    test("enables send button when textarea has content", async () => {
      const user = userEvent.setup();
      render(<ChatInput {...defaultProps} />);
      
      const textarea = screen.getByTestId("chat-message-input");
      const sendButton = screen.getByText("Send");
      
      await user.type(textarea, "Message");
      
      expect(sendButton).not.toBeDisabled();
    });
  });

  describe("Debug Attachment", () => {
    test("renders debug attachment when provided", () => {
      const debugAttachment = { type: "code", content: { code: "test" } };
      render(<ChatInput {...defaultProps} pendingDebugAttachment={debugAttachment as any} />);
      
      expect(screen.getByTestId("debug-attachment")).toBeInTheDocument();
    });

    test("calls onRemoveDebugAttachment when remove button is clicked", async () => {
      const user = userEvent.setup();
      const onRemove = vi.fn();
      const debugAttachment = { type: "code", content: { code: "test" } };
      
      render(
        <ChatInput 
          {...defaultProps} 
          pendingDebugAttachment={debugAttachment as any}
          onRemoveDebugAttachment={onRemove}
        />
      );
      
      const removeButton = screen.getByText("Remove");
      await user.click(removeButton);
      
      expect(onRemove).toHaveBeenCalled();
    });

    test("allows submission with only debug attachment (no text)", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      const debugAttachment = { type: "code", content: { code: "test" } };
      
      render(
        <ChatInput 
          {...defaultProps} 
          onSend={onSend}
          pendingDebugAttachment={debugAttachment as any}
        />
      );
      
      const sendButton = screen.getByText("Send");
      expect(sendButton).not.toBeDisabled();
      
      await user.click(sendButton);
      
      expect(onSend).toHaveBeenCalledWith("", undefined);
    });
  });

  describe("Accessibility", () => {
    test("textarea has correct test id for automation", () => {
      render(<ChatInput {...defaultProps} />);
      
      expect(screen.getByTestId("chat-message-input")).toBeInTheDocument();
    });

    test("send button has correct test id for automation", () => {
      render(<ChatInput {...defaultProps} />);
      
      expect(screen.getByTestId("chat-message-submit")).toBeInTheDocument();
    });

    test("textarea has autofocus", () => {
      render(<ChatInput {...defaultProps} />);
      
      const textarea = screen.getByTestId("chat-message-input");
      expect(textarea).toHaveFocus();
    });
  });

  describe("Edge Cases", () => {
    test("handles very long messages", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const longMessage = "a".repeat(1000);
      const textarea = screen.getByTestId("chat-message-input") as HTMLTextAreaElement;
      
      // Use paste for long messages to avoid timeout
      await user.click(textarea);
      await user.paste(longMessage);
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith(longMessage, undefined);
    });

    test("handles special characters in message", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const specialMessage = "Test with symbols & chars";
      const textarea = screen.getByTestId("chat-message-input") as HTMLTextAreaElement;
      
      // Use paste for special characters to avoid encoding issues
      await user.click(textarea);
      await user.paste(specialMessage);
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith(specialMessage, undefined);
    });

    test("preserves newlines in multi-line submission", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<ChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByTestId("chat-message-input");
      
      await user.type(textarea, "Line 1");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "Line 2");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "Line 3");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("Line 1\nLine 2\nLine 3", undefined);
    });
  });
});
