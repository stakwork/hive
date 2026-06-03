// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children, open, onOpenChange }: any) => (
    <div data-testid="popover" data-open={String(open)}>
      {React.Children.map(children, (child: any) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, { open, onOpenChange })
          : child,
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

vi.mock("lucide-react", () => ({
  History: ({ className }: any) => <svg data-testid="history-icon" className={className} />,
  PlusCircle: ({ className }: any) => <svg data-testid="plus-icon" className={className} />,
}));

// ── Store mock ─────────────────────────────────────────────────────────────

const mockStartConversation = vi.fn(() => "new-conv-id");
const mockSetServerConversationId = vi.fn();
const mockClearActiveConversation = vi.fn();

const mockStoreState = {
  activeConversationId: "active-conv-1",
  conversations: {
    "active-conv-1": {
      context: {
        orgId: "org-1",
        canvasRef: null,
        workspaceSlugs: ["ws-1"],
      },
    },
  },
  startConversation: mockStartConversation,
  setServerConversationId: mockSetServerConversationId,
  clearActiveConversation: mockClearActiveConversation,
};

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: vi.fn((selector: (s: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
  ),
}));

// Provide getState for imperative calls
import * as canvasChatStoreModule from "@/app/org/[githubLogin]/_state/canvasChatStore";

// ── Test data ──────────────────────────────────────────────────────────────

const mockItems = [
  {
    id: "conv-a",
    title: "Planning session",
    preview: "Let's plan the Q3 roadmap",
    lastMessageAt: new Date(Date.now() - 3600000).toISOString(),
    source: "org-canvas",
    isShared: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "conv-b",
    title: null,
    preview: "What are the key milestones?",
    lastMessageAt: new Date(Date.now() - 86400000).toISOString(),
    source: "org-canvas",
    isShared: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockConversationDetail = {
  id: "conv-a",
  userId: "user-1",
  title: "Planning session",
  messages: [
    {
      id: "m1",
      role: "user",
      content: "Let's plan the Q3 roadmap",
      timestamp: new Date().toISOString(),
    },
    {
      id: "m2",
      role: "assistant",
      content: "Sure! Here are some ideas...",
      timestamp: new Date().toISOString(),
    },
  ],
  settings: { extraWorkspaceSlugs: ["ws-1"] },
};

function buildFetch(
  items: typeof mockItems,
  conversationById: Record<string, any>,
) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/chat/conversations?")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ items }),
      });
    }
    for (const [id, conv] of Object.entries(conversationById)) {
      if (url.includes(`/chat/conversations/${id}`)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(conv),
        });
      }
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
  });
}

// ── Import component ───────────────────────────────────────────────────────

import { CanvasHistoryPopover } from "@/app/org/[githubLogin]/_components/CanvasHistoryPopover";

// ── Tests ──────────────────────────────────────────────────────────────────

describe("CanvasHistoryPopover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartConversation.mockReturnValue("new-conv-id");

    // Wire getState for imperative store calls
    (canvasChatStoreModule.useCanvasChatStore as any).getState = vi.fn(
      () => mockStoreState,
    );
  });

  it("shows loading skeleton while fetching", async () => {
    let resolve: (v: any) => void;
    const pending = new Promise((r) => { resolve = r; });
    global.fetch = vi.fn().mockReturnValue(pending);

    render(<CanvasHistoryPopover githubLogin="test-org" />);
    fireEvent.click(screen.getByTestId("popover-trigger"));

    // Skeleton rows use animate-pulse class
    await waitFor(() => {
      const content = screen.getByTestId("popover-content");
      expect(content.innerHTML).toContain("animate-pulse");
    });

    // Resolve to avoid unhandled promise
    resolve!({ ok: true, json: () => Promise.resolve({ items: [] }) });
  });

  it("fetches conversation list when popover opens", async () => {
    global.fetch = buildFetch(mockItems, { "conv-a": mockConversationDetail });

    render(<CanvasHistoryPopover githubLogin="my-org" />);
    fireEvent.click(screen.getByTestId("popover-trigger"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/orgs/my-org/chat/conversations?limit=10"),
      );
    });
  });

  it("renders conversation items with title and timestamp", async () => {
    global.fetch = buildFetch(mockItems, { "conv-a": mockConversationDetail });

    render(<CanvasHistoryPopover githubLogin="my-org" />);
    fireEvent.click(screen.getByTestId("popover-trigger"));

    await waitFor(() => {
      expect(screen.getByText("Planning session")).toBeInTheDocument();
      // untitled falls back to preview
      expect(screen.getByText("What are the key milestones?")).toBeInTheDocument();
    });
  });

  it("shows empty state when no conversations exist", async () => {
    global.fetch = buildFetch([], {});

    render(<CanvasHistoryPopover githubLogin="my-org" />);
    fireEvent.click(screen.getByTestId("popover-trigger"));

    await waitFor(() => {
      expect(screen.getByText("No previous conversations")).toBeInTheDocument();
    });
  });

  it("calls startConversation with ephemeralSeedCount=messages.length and setServerConversationId on item click", async () => {
    global.fetch = buildFetch(mockItems, { "conv-a": mockConversationDetail });

    render(<CanvasHistoryPopover githubLogin="my-org" />);
    fireEvent.click(screen.getByTestId("popover-trigger"));

    // Wait for items to render
    await waitFor(() => screen.getByText("Planning session"));

    // Click the first item
    fireEvent.click(screen.getByText("Planning session"));

    await waitFor(() => {
      expect(mockStartConversation).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: "org-1" }), // context
        expect.arrayContaining([
          expect.objectContaining({ id: "m1", role: "user" }),
          expect.objectContaining({ id: "m2", role: "assistant" }),
        ]),
        undefined, // forkedFromShareId
        2, // ephemeralSeedCount = messages.length
      );
      expect(mockSetServerConversationId).toHaveBeenCalledWith(
        "new-conv-id",
        "conv-a",
      );
    });
  });

  it("calls clearActiveConversation when New conversation is clicked", async () => {
    global.fetch = buildFetch(mockItems, {});

    render(<CanvasHistoryPopover githubLogin="my-org" />);
    fireEvent.click(screen.getByTestId("popover-trigger"));

    await waitFor(() => screen.getByText("Planning session"));

    const newButton = screen.getByTitle("New conversation");
    fireEvent.click(newButton);

    expect(mockClearActiveConversation).toHaveBeenCalled();
  });

  it("closes popover after loading a conversation", async () => {
    global.fetch = buildFetch(mockItems, { "conv-a": mockConversationDetail });

    render(<CanvasHistoryPopover githubLogin="my-org" />);
    fireEvent.click(screen.getByTestId("popover-trigger"));

    await waitFor(() => screen.getByText("Planning session"));

    fireEvent.click(screen.getByText("Planning session"));

    await waitFor(() => {
      // Popover should be closed (content not visible)
      expect(screen.queryByTestId("popover-content")).not.toBeInTheDocument();
    });
  });
});
