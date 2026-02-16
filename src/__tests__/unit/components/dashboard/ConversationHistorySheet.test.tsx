import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { ConversationHistorySheet } from "@/components/dashboard/DashboardChat/ConversationHistorySheet";

// Mock fetch
global.fetch = vi.fn();

describe("ConversationHistorySheet", () => {
  const mockOnOpenChange = vi.fn();
  const mockOnLoadConversation = vi.fn();
  const defaultProps = {
    open: true,
    onOpenChange: mockOnOpenChange,
    onLoadConversation: mockOnLoadConversation,
    workspaceSlug: "test-workspace",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading state correctly", async () => {
    // Mock fetch to delay response
    (global.fetch as any).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        json: async () => ({ conversations: [] })
      }), 100))
    );

    render(<ConversationHistorySheet {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Conversation History")).toBeInTheDocument();
    });
    
    // After fetch completes, should show empty state
    await waitFor(() => {
      expect(screen.getByText("No conversation history yet")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it("renders empty state when no conversations", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: [] }),
    });

    render(<ConversationHistorySheet {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("No conversation history yet")).toBeInTheDocument();
    });
  });

  it("displays conversation list with proper formatting", async () => {
    const mockConversations = [
      {
        id: "conv-1",
        title: "How to implement authentication?",
        preview: "I need help setting up OAuth in my Next.js app...",
        lastMessageAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      },
      {
        id: "conv-2",
        title: "React hooks best practices",
        preview: "What are the best practices for using React hooks?",
        lastMessageAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
      },
      {
        id: "conv-3",
        title: "Database optimization",
        preview: "How can I optimize my database queries?",
        lastMessageAt: new Date("2026-01-15").toISOString(), // Older date
      },
    ];

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: mockConversations }),
    });

    render(<ConversationHistorySheet {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("How to implement authentication?")).toBeInTheDocument();
      expect(screen.getByText("React hooks best practices")).toBeInTheDocument();
      expect(screen.getByText("Database optimization")).toBeInTheDocument();
    });

    // Check previews
    expect(screen.getByText(/I need help setting up OAuth/)).toBeInTheDocument();
    expect(screen.getByText(/What are the best practices/)).toBeInTheDocument();

    // Check relative timestamps - verify "Yesterday" is displayed for the second conversation
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
  });

  it("calls onLoadConversation with correct ID on click", async () => {
    const mockConversations = [
      {
        id: "conv-123",
        title: "Test Conversation",
        preview: "Test preview text",
        lastMessageAt: new Date().toISOString(),
      },
    ];

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: mockConversations }),
    });

    const user = userEvent.setup();
    render(<ConversationHistorySheet {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("Test Conversation")).toBeInTheDocument();
    });

    const conversationItem = screen.getByText("Test Conversation");
    await user.click(conversationItem);

    expect(mockOnLoadConversation).toHaveBeenCalledWith("conv-123");
  });

  it("handles API errors gracefully", async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

    render(<ConversationHistorySheet {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load conversations/)).toBeInTheDocument();
    });
  });

  it("fetches conversations with correct API endpoint", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: [] }),
    });

    render(<ConversationHistorySheet {...defaultProps} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/workspaces/test-workspace/chat/conversations?limit=10",
      );
    });
  });

  it("does not fetch when sheet is closed", () => {
    render(<ConversationHistorySheet {...defaultProps} open={false} />);

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("truncates long titles properly", async () => {
    const mockConversations = [
      {
        id: "conv-1",
        title: "This is an extremely long conversation title that should be truncated in the UI to prevent overflow and maintain proper layout",
        preview: "Preview text",
        lastMessageAt: new Date().toISOString(),
      },
    ];

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ conversations: mockConversations }),
    });

    render(<ConversationHistorySheet {...defaultProps} />);

    await waitFor(() => {
      const titleElement = screen.getByText(/This is an extremely long/);
      expect(titleElement).toBeInTheDocument();
      // Title should have line-clamp-1 class for truncation
      expect(titleElement.className).toContain("line-clamp-1");
    });
  });
});
