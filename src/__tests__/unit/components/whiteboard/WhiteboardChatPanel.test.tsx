import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { WhiteboardChatPanel } from "@/components/whiteboard/WhiteboardChatPanel";
import * as pusherLib from "@/lib/pusher";
import { toast } from "sonner";

// Mock dependencies
vi.mock("@/lib/pusher");
vi.mock("sonner");

const mockPusherClient = {
  subscribe: vi.fn(() => ({
    bind: vi.fn(),
    unbind: vi.fn(),
  })),
  unsubscribe: vi.fn(),
};

const mockExcalidrawAPI = {
  scrollToContent: vi.fn(),
};

describe("WhiteboardChatPanel", () => {
  const defaultProps = {
    whiteboardId: "wb-123",
    featureId: "feat-456",
    excalidrawAPI: mockExcalidrawAPI as any,
    onReloadWhiteboard: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    
    vi.mocked(pusherLib.getPusherClient).mockReturnValue(mockPusherClient as any);
    vi.mocked(pusherLib.getWhiteboardChannelName).mockReturnValue("whiteboard-wb-123");
    vi.mocked(pusherLib.PUSHER_EVENTS).WHITEBOARD_CHAT_MESSAGE = "whiteboard-chat-message";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders empty state when message list is empty", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    } as Response);

    render(<WhiteboardChatPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
    });
  });

  it("renders a list of messages with correct alignment", async () => {
    const messages = [
      {
        id: "1",
        role: "USER" as const,
        content: "User message",
        createdAt: new Date().toISOString(),
        userId: "user-1",
      },
      {
        id: "2",
        role: "ASSISTANT" as const,
        content: "Assistant reply",
        createdAt: new Date().toISOString(),
        userId: null,
      },
    ];

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: messages }),
    } as Response);

    render(<WhiteboardChatPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("User message")).toBeInTheDocument();
      expect(screen.getByText("Assistant reply")).toBeInTheDocument();
    });

    // Check alignment classes
    const userMessage = screen.getByText("User message").closest("div");
    const assistantMessage = screen.getByText("Assistant reply").closest("div");
    
    expect(userMessage?.parentElement?.className).toContain("justify-end");
    expect(assistantMessage?.parentElement?.className).toContain("justify-start");
  });

  it("appends an optimistic message on send and clears input", async () => {
    const user = userEvent.setup();

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          success: true,
          data: {
            message: {
              id: "msg-1",
              role: "USER",
              content: "Test message",
              createdAt: new Date().toISOString(),
              userId: "user-1",
            },
            runId: "run-123",
          },
        }),
      } as Response);

    render(<WhiteboardChatPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByText(/no messages yet/i)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/ask to update the diagram/i);
    await user.type(textarea, "Test message");
    
    const sendButton = screen.getByRole("button", { name: "" });
    await user.click(sendButton);

    // Optimistic message should appear
    await waitFor(() => {
      expect(screen.getByText("Test message")).toBeInTheDocument();
    });

    // Input should be cleared
    expect(textarea).toHaveValue("");
  });

  it("shows spinner when generating is true", async () => {
    const user = userEvent.setup();

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          success: true,
          data: {
            message: {
              id: "msg-1",
              role: "USER",
              content: "Test",
              createdAt: new Date().toISOString(),
              userId: "user-1",
            },
            runId: "run-123",
          },
        }),
      } as Response);

    render(<WhiteboardChatPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByText(/no messages yet/i)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/ask to update the diagram/i);
    await user.type(textarea, "Test");
    
    const sendButton = screen.getByRole("button", { name: "" });
    await user.click(sendButton);

    // Spinner should appear
    await waitFor(() => {
      expect(screen.getByText(/generating diagram/i)).toBeInTheDocument();
    });
  });

  it("shows toast and removes optimistic message on 409 conflict", async () => {
    const user = userEvent.setup();

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: "Diagram generation in progress" }),
      } as Response);

    render(<WhiteboardChatPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByText(/no messages yet/i)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/ask to update the diagram/i);
    await user.type(textarea, "Test message");
    
    const sendButton = screen.getByRole("button", { name: "" });
    await user.click(sendButton);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Diagram generation already in progress");
    });

    // Optimistic message should be removed
    await waitFor(() => {
      expect(screen.queryByText("Test message")).not.toBeInTheDocument();
    });
  });

  it("calls onReloadWhiteboard when Pusher event is received", async () => {
    const mockChannel = {
      bind: vi.fn(),
      unbind: vi.fn(),
    };

    const mockPusher = {
      subscribe: vi.fn(() => mockChannel),
      unsubscribe: vi.fn(),
    };

    vi.mocked(pusherLib.getPusherClient).mockReturnValue(mockPusher as any);

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    } as Response);

    const onReloadWhiteboard = vi.fn().mockResolvedValue(undefined);

    render(
      <WhiteboardChatPanel
        {...defaultProps}
        onReloadWhiteboard={onReloadWhiteboard}
      />
    );

    await waitFor(() => {
      expect(mockPusher.subscribe).toHaveBeenCalledWith("whiteboard-wb-123");
    });

    // Get the callback registered with Pusher
    const pusherCallback = mockChannel.bind.mock.calls[0]?.[1];
    expect(pusherCallback).toBeDefined();

    // Simulate Pusher event
    const assistantMessage = {
      id: "msg-2",
      role: "ASSISTANT",
      content: "Diagram updated",
      createdAt: new Date().toISOString(),
      userId: null,
    };

    await pusherCallback({ message: assistantMessage });

    await waitFor(() => {
      expect(onReloadWhiteboard).toHaveBeenCalled();
      expect(mockExcalidrawAPI.scrollToContent).toHaveBeenCalledWith(undefined, {
        fitToViewport: true,
        viewportZoomFactor: 0.9,
        animate: true,
        duration: 300,
      });
    });
  });

  it("enables input and Send button when featureId is null", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    } as Response);

    render(<WhiteboardChatPanel {...defaultProps} featureId={null} />);

    await waitFor(() => {
      expect(screen.queryByText(/link this whiteboard to a feature/i)).not.toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/ask to update the diagram/i);
    expect(textarea).not.toBeDisabled();

    const sendButton = screen.getByRole("button", { name: "" });
    expect(sendButton).toBeDisabled(); // Still disabled because input is empty
  });

  it("sends message successfully when featureId is null", async () => {
    const user = userEvent.setup();

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({
          success: true,
          data: {
            message: {
              id: "msg-123",
              whiteboardId: "wb-123",
              role: "USER",
              content: "Update the diagram",
              status: "SENT",
              createdAt: new Date().toISOString(),
              userId: "user-123",
            },
            runId: "run-123",
          },
        }),
      } as Response);

    render(<WhiteboardChatPanel {...defaultProps} featureId={null} />);

    await waitFor(() => {
      expect(screen.queryByText(/no messages yet/i)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/ask to update the diagram/i);
    await user.type(textarea, "Update the diagram");

    const sendButton = screen.getByRole("button", { name: "" });
    await user.click(sendButton);

    // Verify fetch was called for POST (the second call)
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    // Verify the POST call had correct body
    const postCall = vi.mocked(global.fetch).mock.calls[1];
    expect(postCall[0]).toBe("/api/whiteboards/wb-123/messages");
    expect(postCall[1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Update the diagram", layout: "layered" }),
    });

    // Verify optimistic message appears
    await waitFor(() => {
      expect(screen.getByText("Update the diagram")).toBeInTheDocument();
    });
  });

  it("disables input and Send button when generating is true", async () => {
    const user = userEvent.setup();

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      } as Response)
      .mockResolvedValueOnce(
        new Promise(() => {}) // Never resolves to keep generating state
      );

    render(<WhiteboardChatPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByText(/no messages yet/i)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/ask to update the diagram/i);
    await user.type(textarea, "Test");
    
    const sendButton = screen.getByRole("button", { name: "" });
    await user.click(sendButton);

    // While generating, input and button should be disabled
    await waitFor(() => {
      expect(textarea).toBeDisabled();
      expect(sendButton).toBeDisabled();
    });
  });

  it("collapses and expands the panel", async () => {
    const user = userEvent.setup();

    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, data: [] }),
    } as Response);

    render(<WhiteboardChatPanel {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Chat")).toBeInTheDocument();
    });

    // Find and click collapse button
    const collapseButton = screen.getByTitle("Collapse chat");
    await user.click(collapseButton);

    // Panel should collapse - only expand button visible
    await waitFor(() => {
      expect(screen.queryByText("Chat")).not.toBeInTheDocument();
      expect(screen.getByTitle("Expand chat")).toBeInTheDocument();
    });

    // Click expand button
    const expandButton = screen.getByTitle("Expand chat");
    await user.click(expandButton);

    // Panel should expand again
    await waitFor(() => {
      expect(screen.getByText("Chat")).toBeInTheDocument();
    });
  });
});
