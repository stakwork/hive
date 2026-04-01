import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// ── mocks ─────────────────────────────────────────────────────────────────────

// Popover: controlled stub that renders content inline when open
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, open, onOpenChange }: any) => (
    <div data-testid="popover" data-open={String(open)}>
      {React.Children.map(children, (child: any) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, { open, onOpenChange })
          : child
      )}
    </div>
  ),
  PopoverTrigger: ({ children, asChild, open, onOpenChange }: any) => (
    <button data-testid="popover-trigger" onClick={() => onOpenChange?.(!open)}>
      {children}
    </button>
  ),
  PopoverContent: ({ children, open }: any) =>
    open ? <div data-testid="popover-content">{children}</div> : null,
}));

import { RecentChatsPopup } from "@/components/dashboard/DashboardChat/RecentChatsPopup";

// ── helpers ───────────────────────────────────────────────────────────────────

const CURRENT_USER_ID = "user-owner-1";

const mockRecentItems = [
  {
    id: "conv-1",
    title: "How does auth work",
    lastMessageAt: new Date(Date.now() - 3600000).toISOString(), // 1h ago
    creatorName: "Paul Smith",
    creatorId: CURRENT_USER_ID, // owner
    source: "dashboard",
  },
  {
    id: "conv-2",
    title: "Explain the database schema",
    lastMessageAt: new Date(Date.now() - 86400000).toISOString(), // 1d ago
    creatorName: "Alice Johnson",
    creatorId: "user-other-2", // non-owner
    source: "dashboard",
  },
];

const mockConversationOwner = {
  id: "conv-1",
  userId: CURRENT_USER_ID,
  title: "How does auth work",
  messages: [
    { id: "m1", role: "user", content: "How does auth work?", timestamp: new Date().toISOString() },
    { id: "m2", role: "assistant", content: "Auth uses NextAuth.", timestamp: new Date().toISOString() },
  ],
  settings: { extraWorkspaceSlugs: ["other-ws"] },
};

const mockConversationNonOwner = {
  id: "conv-2",
  userId: "user-other-2",
  title: "Explain the database schema",
  messages: [
    { id: "m3", role: "user", content: "Explain DB.", timestamp: new Date().toISOString() },
  ],
  settings: { extraWorkspaceSlugs: [] },
};

function buildFetch(recentItems: any[], conversationById: Record<string, any>) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/chat/recent")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items: recentItems }),
      });
    }
    // Match /chat/conversations/[id]
    const match = url.match(/\/chat\/conversations\/([^?]+)/);
    if (match) {
      const id = match[1];
      const conv = conversationById[id];
      if (conv) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(conv) });
      }
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("RecentChatsPopup", () => {
  const mockOnLoadConversation = vi.fn();
  const defaultProps = {
    slug: "test-workspace",
    currentUserId: CURRENT_USER_ID,
    onLoadConversation: mockOnLoadConversation,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders trigger button with 'Recent Chats' label", () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ items: [] }) });
    render(<RecentChatsPopup {...defaultProps} />);
    expect(screen.getByText("Recent Chats")).toBeInTheDocument();
  });

  test("fetches /recent on open and renders list with 'title (FirstName)' format", async () => {
    global.fetch = buildFetch(mockRecentItems, {
      "conv-1": mockConversationOwner,
      "conv-2": mockConversationNonOwner,
    });

    render(<RecentChatsPopup {...defaultProps} />);

    // Open the popover
    await userEvent.click(screen.getByText("Recent Chats"));

    await waitFor(() => {
      // First item: owner
      expect(screen.getByText("How does auth work (Paul)")).toBeInTheDocument();
      // Second item: non-owner
      expect(screen.getByText("Explain the database schema (Alice)")).toBeInTheDocument();
    });

    // Verify /recent was fetched
    const fetchCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(fetchCalls.some((c: any[]) => c[0].includes("/chat/recent"))).toBe(true);
  });

  test("shows empty state when list is empty", async () => {
    global.fetch = buildFetch([], {});

    render(<RecentChatsPopup {...defaultProps} />);
    await userEvent.click(screen.getByText("Recent Chats"));

    await waitFor(() => {
      expect(screen.getByText("No recent chats yet")).toBeInTheDocument();
    });
  });

  test("owner click: calls onLoadConversation with isReadOnly=false and correct conversationId", async () => {
    global.fetch = buildFetch(mockRecentItems, {
      "conv-1": mockConversationOwner,
      "conv-2": mockConversationNonOwner,
    });

    render(<RecentChatsPopup {...defaultProps} />);
    await userEvent.click(screen.getByText("Recent Chats"));

    await waitFor(() => {
      expect(screen.getByText("How does auth work (Paul)")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("How does auth work (Paul)"));

    await waitFor(() => {
      expect(mockOnLoadConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          isReadOnly: false,
          conversationId: "conv-1",
          extraWorkspaceSlugs: ["other-ws"],
        })
      );
    });
  });

  test("non-owner click: calls onLoadConversation with isReadOnly=true and conversationId=null", async () => {
    global.fetch = buildFetch(mockRecentItems, {
      "conv-1": mockConversationOwner,
      "conv-2": mockConversationNonOwner,
    });

    render(<RecentChatsPopup {...defaultProps} />);
    await userEvent.click(screen.getByText("Recent Chats"));

    await waitFor(() => {
      expect(screen.getByText("Explain the database schema (Alice)")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Explain the database schema (Alice)"));

    await waitFor(() => {
      expect(mockOnLoadConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          isReadOnly: true,
          conversationId: null,
          extraWorkspaceSlugs: [],
        })
      );
    });
  });

  test("maps messages correctly from stored format to local Message[]", async () => {
    global.fetch = buildFetch([mockRecentItems[0]], { "conv-1": mockConversationOwner });

    render(<RecentChatsPopup {...defaultProps} />);
    await userEvent.click(screen.getByText("Recent Chats"));

    await waitFor(() => {
      expect(screen.getByText("How does auth work (Paul)")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("How does auth work (Paul)"));

    await waitFor(() => {
      const call = mockOnLoadConversation.mock.calls[0][0];
      expect(call.messages).toHaveLength(2);
      expect(call.messages[0]).toMatchObject({ role: "user", content: "How does auth work?" });
      expect(call.messages[1]).toMatchObject({ role: "assistant", content: "Auth uses NextAuth." });
    });
  });
});
