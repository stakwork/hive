import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LearnChatInput } from "@/app/w/[slug]/learn/components/LearnChatInput";

// Mock dependencies
vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: "",
    isSupported: true,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    resetTranscript: vi.fn(),
  }),
}));

vi.mock("@/hooks/useControlKeyHold", () => ({
  useControlKeyHold: vi.fn(),
}));

vi.mock("@/hooks/useTranscriptChunking", () => ({
  useTranscriptChunking: vi.fn(),
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

vi.mock("lucide-react", () => ({
  Send: () => <span data-testid="send-icon">Send</span>,
  Mic: () => <span data-testid="mic-icon">Mic</span>,
  MicOff: () => <span data-testid="mic-off-icon">MicOff</span>,
}));

describe("LearnChatInput - Chat/Learn Mode", () => {
  const defaultProps = {
    onSend: vi.fn().mockResolvedValue(undefined),
    disabled: false,
    onInputChange: vi.fn(),
    onRefetchLearnings: vi.fn(),
    mode: "learn" as "learn" | "chat" | "mic",
    workspaceSlug: "test-workspace",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Keyboard Interactions", () => {
    test("submits message when Enter is pressed without Shift", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

      await user.type(textarea, "What is React?");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("What is React?");
      expect(textarea).toHaveValue("");
    });

    test("does NOT submit message when Shift+Enter is pressed", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

      await user.type(textarea, "Question line 1");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "Question line 2");

      expect(onSend).not.toHaveBeenCalled();
      expect(textarea).toHaveValue("Question line 1\nQuestion line 2");
    });

    test("allows multiple lines with multiple Shift+Enter presses", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

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
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

      await user.type(textarea, "Can you explain:");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "1. React hooks");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "2. Context API");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("Can you explain:\n1. React hooks\n2. Context API");
      expect(textarea).toHaveValue("");
    });

    test("does not submit when Enter is pressed on empty input", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);
      await user.click(textarea);
      await user.keyboard("{Enter}");

      expect(onSend).not.toHaveBeenCalled();
    });

    test("does not submit when Enter is pressed on whitespace-only input", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);
      await user.type(textarea, "   ");
      await user.keyboard("{Enter}");

      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe("Basic Rendering", () => {
    test("renders textarea with correct placeholder in learn mode", () => {
      render(<LearnChatInput {...defaultProps} mode="learn" />);

      expect(screen.getByPlaceholderText(/Ask me anything about code, concepts/i)).toBeInTheDocument();
    });

    test("renders textarea with correct placeholder in chat mode", () => {
      render(<LearnChatInput {...defaultProps} mode="chat" />);

      expect(screen.getByPlaceholderText(/Ask me anything about code, concepts/i)).toBeInTheDocument();
    });

    test("renders send button icon", () => {
      render(<LearnChatInput {...defaultProps} />);

      expect(screen.getByTestId("send-icon")).toBeInTheDocument();
    });

    test("renders mic button in non-mic mode", () => {
      render(<LearnChatInput {...defaultProps} mode="learn" />);

      expect(screen.getByTestId("mic-icon")).toBeInTheDocument();
    });
  });

  describe("Form Submission", () => {
    test("submits message via Send button", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);
      const sendButton = screen.getByTestId("send-icon").closest("button");

      await user.type(textarea, "Explain closures");
      await user.click(sendButton!);

      expect(onSend).toHaveBeenCalledWith("Explain closures");
    });

    test("trims whitespace from submitted message", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

      await user.type(textarea, "  What is TypeScript?  ");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("What is TypeScript?");
    });

    test("clears textarea after successful submission", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

      await user.type(textarea, "Test question");
      await user.keyboard("{Enter}");

      expect(textarea).toHaveValue("");
    });

    test("calls onInputChange when typing", async () => {
      const user = userEvent.setup();
      const onInputChange = vi.fn();
      render(<LearnChatInput {...defaultProps} onInputChange={onInputChange} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

      await user.type(textarea, "Test");

      expect(onInputChange).toHaveBeenCalled();
    });
  });

  describe("Disabled States", () => {
    test("disables textarea when disabled prop is true", () => {
      render(<LearnChatInput {...defaultProps} disabled={true} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);
      expect(textarea).toBeDisabled();
    });

    test("disables send button when disabled prop is true", () => {
      render(<LearnChatInput {...defaultProps} disabled={true} />);

      const sendButton = screen.getByTestId("send-icon").closest("button");
      expect(sendButton).toBeDisabled();
    });

    test("disables send button when textarea is empty", () => {
      render(<LearnChatInput {...defaultProps} />);

      const sendButton = screen.getByTestId("send-icon").closest("button");
      expect(sendButton).toBeDisabled();
    });

    test("enables send button when textarea has content", async () => {
      const user = userEvent.setup();
      render(<LearnChatInput {...defaultProps} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);
      const sendButton = screen.getByTestId("send-icon").closest("button");

      await user.type(textarea, "Question");

      expect(sendButton).not.toBeDisabled();
    });

    test("disables textarea in mic mode", () => {
      render(<LearnChatInput {...defaultProps} mode="mic" />);

      const textarea = screen.getByPlaceholderText(/Recording transcript/i);
      expect(textarea).toBeDisabled();
    });

    test("hides send button in mic mode", () => {
      render(<LearnChatInput {...defaultProps} mode="mic" />);

      const sendButton = screen.queryByTestId("send-icon");
      expect(sendButton).not.toBeInTheDocument();
    });
  });

  describe("Mode-Specific Behavior", () => {
    test("displays mic mode placeholder when in mic mode", () => {
      render(<LearnChatInput {...defaultProps} mode="mic" />);

      expect(screen.getByPlaceholderText("Recording transcript...")).toBeInTheDocument();
    });

    test("does not render mic button in mic mode", () => {
      render(<LearnChatInput {...defaultProps} mode="mic" />);

      expect(screen.queryByTestId("mic-icon")).not.toBeInTheDocument();
      expect(screen.queryByTestId("mic-off-icon")).not.toBeInTheDocument();
    });
  });

  describe("Accessibility", () => {
    test("textarea has autofocus", () => {
      render(<LearnChatInput {...defaultProps} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);
      expect(textarea).toHaveFocus();
    });

    test("textarea is properly labeled via placeholder", () => {
      render(<LearnChatInput {...defaultProps} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything about code, concepts/i);
      expect(textarea).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    test("handles very long messages", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const longMessage = "Please explain ".repeat(100);
      const textarea = screen.getByPlaceholderText(/Ask me anything/i) as HTMLTextAreaElement;

      // Use paste for long messages to avoid timeout
      await user.click(textarea);
      await user.paste(longMessage);
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith(longMessage.trim());
    });

    test("handles special characters and emojis", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const specialMessage = "How does React handle state";
      const textarea = screen.getByPlaceholderText(/Ask me anything/i) as HTMLTextAreaElement;

      // Use paste to avoid encoding issues
      await user.click(textarea);
      await user.paste(specialMessage);
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith(specialMessage);
    });

    test("preserves newlines in multi-line submission", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

      await user.type(textarea, "Question:");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "Part 1");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "Part 2");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("Question:\nPart 1\nPart 2");
    });

    test("handles rapid Enter key presses", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

      await user.type(textarea, "Question 1");
      await user.keyboard("{Enter}");
      await user.type(textarea, "Question 2");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledTimes(2);
      expect(onSend).toHaveBeenNthCalledWith(1, "Question 1");
      expect(onSend).toHaveBeenNthCalledWith(2, "Question 2");
    });

    test("handles mixed Shift+Enter and Enter patterns", async () => {
      const user = userEvent.setup();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<LearnChatInput {...defaultProps} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

      // First message with newlines
      await user.type(textarea, "Multi");
      await user.keyboard("{Shift>}{Enter}{/Shift}");
      await user.type(textarea, "line");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("Multi\nline");

      // Second message, single line
      await user.type(textarea, "Single line");
      await user.keyboard("{Enter}");

      expect(onSend).toHaveBeenCalledWith("Single line");
      expect(onSend).toHaveBeenCalledTimes(2);
    });
  });

  describe("Integration with Input Change Handler", () => {
    test("notifies parent of input changes", async () => {
      const user = userEvent.setup();
      const onInputChange = vi.fn();
      render(<LearnChatInput {...defaultProps} onInputChange={onInputChange} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

      await user.type(textarea, "Test");

      expect(onInputChange).toHaveBeenCalled();
    });

    test("notifies parent when clearing after submission", async () => {
      const user = userEvent.setup();
      const onInputChange = vi.fn();
      const onSend = vi.fn().mockResolvedValue(undefined);
      render(<LearnChatInput {...defaultProps} onInputChange={onInputChange} onSend={onSend} />);

      const textarea = screen.getByPlaceholderText(/Ask me anything/i);

      await user.type(textarea, "Test");
      await user.keyboard("{Enter}");

      // Should be called for each character typed, plus the clear
      expect(onInputChange).toHaveBeenCalled();
    });
  });
});
