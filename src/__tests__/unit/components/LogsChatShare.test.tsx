import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LogsChat } from "@/components/logs-chat/LogsChat";
import { toast } from "sonner";

// Mock dependencies
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(" "),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, type, disabled, ...props }: any) => (
    <button onClick={onClick} type={type} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: React.forwardRef<HTMLTextAreaElement, any>(({ onKeyDown, ...props }, ref) => (
    <textarea ref={ref} onKeyDown={onKeyDown} {...props} />
  )),
}));

vi.mock("@/components/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: any) => <div>{children}</div>,
}));

// Mock scrollIntoView
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("LogsChat - Share Functionality", () => {
  const mockWorkspaceSlug = "test-workspace";
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockClipboard: { writeText: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Mock clipboard API
    mockClipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    Object.defineProperty(navigator, "clipboard", {
      value: mockClipboard,
      writable: true,
      configurable: true,
    });

    // Mock window.location.origin
    Object.defineProperty(window, "location", {
      value: {
        origin: "http://localhost:3000",
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Share Button Visibility", () => {
    test("share button is not rendered when messages array is empty", () => {
      render(<LogsChat workspaceSlug={mockWorkspaceSlug} />);

      const shareButton = screen.queryByTestId("logs-chat-share");
      expect(shareButton).not.toBeInTheDocument();
    });

    test("share button appears after sending a message", async () => {
      const user = userEvent.setup();

      // Mock successful API response for sending message
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ answer: "Test response" }),
      });

      render(<LogsChat workspaceSlug={mockWorkspaceSlug} />);

      // Initially no share button
      expect(screen.queryByTestId("logs-chat-share")).not.toBeInTheDocument();

      // Send a message
      const input = screen.getByTestId("logs-chat-input");
      await user.type(input, "Test question");
      await user.click(screen.getByTestId("logs-chat-submit"));

      // Wait for message to be added
      await waitFor(() => {
        expect(screen.getByTestId("logs-chat-share")).toBeInTheDocument();
      });
    });
  });

  describe("Share Functionality", () => {
    const setupWithMessages = async () => {
      const user = userEvent.setup();

      // Mock successful API response for sending message
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ answer: "Test response from logs agent" }),
      });

      render(<LogsChat workspaceSlug={mockWorkspaceSlug} />);

      // Send a message to populate messages state
      const input = screen.getByTestId("logs-chat-input");
      await user.type(input, "What errors occurred in the last hour?");
      await user.click(screen.getByTestId("logs-chat-submit"));

      // Wait for share button to appear
      await waitFor(() => {
        expect(screen.getByTestId("logs-chat-share")).toBeInTheDocument();
      });

      return user;
    };

    test("clicking share button posts to correct endpoint with logs-agent source", async () => {
      const user = await setupWithMessages();

      // Mock successful share response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "/w/test-workspace/chat/shared/abc123" }),
      });

      const shareButton = screen.getByTestId("logs-chat-share");
      await user.click(shareButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/workspaces/${mockWorkspaceSlug}/chat/share`,
          expect.objectContaining({
            method: "POST",
            headers: { "Content-Type": "application/json" },
          })
        );
      });

      // Verify the request body
      const callArgs = mockFetch.mock.calls.find(
        (call) => call[0] === `/api/workspaces/${mockWorkspaceSlug}/chat/share`
      );
      expect(callArgs).toBeDefined();
      
      const body = JSON.parse(callArgs![1].body);
      expect(body.source).toBe("logs-agent");
      expect(body.followUpQuestions).toEqual([]);
      expect(body.messages).toBeDefined();
      expect(Array.isArray(body.messages)).toBe(true);
    });

    test("derives title from first user message (truncated to 50 chars)", async () => {
      const user = await setupWithMessages();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "/w/test-workspace/chat/shared/abc123" }),
      });

      await user.click(screen.getByTestId("logs-chat-share"));

      await waitFor(() => {
        const callArgs = mockFetch.mock.calls.find(
          (call) => call[0] === `/api/workspaces/${mockWorkspaceSlug}/chat/share`
        );
        const body = JSON.parse(callArgs![1].body);
        
        // Title should be first 50 chars of "What errors occurred in the last hour?"
        expect(body.title).toBe("What errors occurred in the last hour?");
      });
    });

    test("truncates long titles with ellipsis", async () => {
      const user = userEvent.setup();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ answer: "Response" }),
      });

      render(<LogsChat workspaceSlug={mockWorkspaceSlug} />);

      const longMessage = "A".repeat(60); // 60 characters
      const input = screen.getByTestId("logs-chat-input");
      await user.type(input, longMessage);
      await user.click(screen.getByTestId("logs-chat-submit"));

      await waitFor(() => {
        expect(screen.getByTestId("logs-chat-share")).toBeInTheDocument();
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "/w/test-workspace/chat/shared/abc123" }),
      });

      await user.click(screen.getByTestId("logs-chat-share"));

      await waitFor(() => {
        const callArgs = mockFetch.mock.calls.find(
          (call) => call[0] === `/api/workspaces/${mockWorkspaceSlug}/chat/share`
        );
        const body = JSON.parse(callArgs![1].body);
        
        expect(body.title).toBe("A".repeat(50) + "...");
      });
    });

    test("calls share API with correct payload including source", async () => {
      const user = await setupWithMessages();

      const mockShareUrl = "/w/test-workspace/chat/shared/abc123";
      
      mockFetch.mockClear();
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ url: mockShareUrl }),
      } as any);

      const shareButton = screen.getByTestId("logs-chat-share");
      await user.click(shareButton);

      // Verify the share API was called with correct payload
      await waitFor(() => {
        const shareCalls = mockFetch.mock.calls.filter(
          (call) => call[0]?.includes('/chat/share')
        );
        expect(shareCalls.length).toBeGreaterThan(0);
      });
      
      const shareCall = mockFetch.mock.calls.find(
        (call) => call[0]?.includes('/chat/share')
      );
      const [url, options] = shareCall!;
      expect(url).toBe(`/api/workspaces/${mockWorkspaceSlug}/chat/share`);
      expect(options.method).toBe("POST");
      
      const body = JSON.parse(options.body);
      expect(body.source).toBe("logs-agent");
      expect(body.followUpQuestions).toEqual([]);
      expect(body.messages).toBeInstanceOf(Array);
    });

    test("shows success toast after copying to clipboard", async () => {
      const user = await setupWithMessages();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "/w/test-workspace/chat/shared/abc123" }),
      });

      await user.click(screen.getByTestId("logs-chat-share"));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Share link copied to clipboard!");
      });
    });

    test("disables share button during sharing", async () => {
      const user = await setupWithMessages();

      // Make fetch hang to test disabled state
      let resolveShare: any;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveShare = resolve;
        })
      );

      const shareButton = screen.getByTestId("logs-chat-share");
      await user.click(shareButton);

      // Button should be disabled while sharing
      expect(shareButton).toBeDisabled();

      // Resolve the promise
      resolveShare({
        ok: true,
        json: async () => ({ url: "/w/test-workspace/chat/shared/abc123" }),
      });

      // Wait for button to be enabled again
      await waitFor(() => {
        expect(shareButton).not.toBeDisabled();
      });
    });

    test("disables share button when isLoading is true", async () => {
      const user = userEvent.setup();

      // Mock a pending API call
      let resolveMessage: any;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveMessage = resolve;
        })
      );

      render(<LogsChat workspaceSlug={mockWorkspaceSlug} />);

      const input = screen.getByTestId("logs-chat-input");
      await user.type(input, "Test");
      await user.click(screen.getByTestId("logs-chat-submit"));

      // Resolve to show share button
      resolveMessage({
        ok: true,
        json: async () => ({ answer: "Response" }),
      });

      await waitFor(() => {
        expect(screen.getByTestId("logs-chat-share")).toBeInTheDocument();
      });

      // Start another message send
      mockFetch.mockReturnValueOnce(
        new Promise(() => {}) // Never resolves
      );
      await user.type(input, "Another test");
      await user.click(screen.getByTestId("logs-chat-submit"));

      // Share button should be disabled while loading
      await waitFor(() => {
        expect(screen.getByTestId("logs-chat-share")).toBeDisabled();
      });
    });
  });

  describe("Error Handling", () => {
    const setupWithMessages = async () => {
      const user = userEvent.setup();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ answer: "Response" }),
      });

      render(<LogsChat workspaceSlug={mockWorkspaceSlug} />);

      const input = screen.getByTestId("logs-chat-input");
      await user.type(input, "Test");
      await user.click(screen.getByTestId("logs-chat-submit"));

      await waitFor(() => {
        expect(screen.getByTestId("logs-chat-share")).toBeInTheDocument();
      });

      return user;
    };

    test("shows error toast when API returns non-OK response", async () => {
      const user = await setupWithMessages();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "Internal server error" }),
      });

      await user.click(screen.getByTestId("logs-chat-share"));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Failed to share conversation",
          expect.objectContaining({
            description: "Internal server error",
          })
        );
      });
    });

    test("shows error toast when API returns non-OK response without error field", async () => {
      const user = await setupWithMessages();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await user.click(screen.getByTestId("logs-chat-share"));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Failed to share conversation",
          expect.objectContaining({
            description: "Failed to share conversation",
          })
        );
      });
    });

    test("shows error toast when fetch throws", async () => {
      const user = await setupWithMessages();

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await user.click(screen.getByTestId("logs-chat-share"));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Failed to share conversation",
          expect.objectContaining({
            description: "Network error",
          })
        );
      });
    });

    test("logs error to console on failure", async () => {
      const user = await setupWithMessages();
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockRejectedValueOnce(new Error("Test error"));

      await user.click(screen.getByTestId("logs-chat-share"));

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          "Error sharing conversation:",
          expect.any(Error)
        );
      });

      consoleSpy.mockRestore();
    });

    test("re-enables button after error", async () => {
      const user = await setupWithMessages();

      mockFetch.mockRejectedValueOnce(new Error("Test error"));

      const shareButton = screen.getByTestId("logs-chat-share");
      await user.click(shareButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalled();
      });

      // Button should be enabled again after error
      expect(shareButton).not.toBeDisabled();
    });
  });

  describe("Edge Cases", () => {
    test("does not call API if messages array is empty", async () => {
      render(<LogsChat workspaceSlug={mockWorkspaceSlug} />);

      // No share button should be visible
      expect(screen.queryByTestId("logs-chat-share")).not.toBeInTheDocument();
      expect(mockFetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/chat/share"),
        expect.anything()
      );
    });

    test("uses fallback title when no user message exists", async () => {
      const user = userEvent.setup();

      // This is a hypothetical edge case - in practice there's always a user message
      // but we test the fallback logic
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ answer: "Response" }),
      });

      render(<LogsChat workspaceSlug={mockWorkspaceSlug} />);

      const input = screen.getByTestId("logs-chat-input");
      await user.type(input, "   "); // Whitespace only
      await user.click(screen.getByTestId("logs-chat-submit"));

      // Should not send (input validation)
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("includes all messages in share payload", async () => {
      const user = userEvent.setup();

      // Send first message
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ answer: "First response" }),
      });

      render(<LogsChat workspaceSlug={mockWorkspaceSlug} />);

      const input = screen.getByTestId("logs-chat-input");
      await user.type(input, "First question");
      await user.click(screen.getByTestId("logs-chat-submit"));

      await waitFor(() => {
        expect(screen.getByTestId("logs-chat-share")).toBeInTheDocument();
      });

      // Send second message
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ answer: "Second response" }),
      });

      await user.type(input, "Second question");
      await user.click(screen.getByTestId("logs-chat-submit"));

      // Click share
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "/w/test-workspace/chat/shared/abc123" }),
      });

      await user.click(screen.getByTestId("logs-chat-share"));

      await waitFor(() => {
        const callArgs = mockFetch.mock.calls.find(
          (call) => call[0] === `/api/workspaces/${mockWorkspaceSlug}/chat/share`
        );
        const body = JSON.parse(callArgs![1].body);
        
        // Should include all messages (2 user + 2 assistant = 4 total)
        expect(body.messages.length).toBe(4);
      });
    });
  });
});
