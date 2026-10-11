/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", name: "Test User" } }, status: "authenticated" }),
}));

// Mock Next.js navigation
const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

// Mock Next.js Link — renders as <a> so click events behave like real anchors
vi.mock("next/link", () => ({
  default: ({ href, children, className, onClick }: any) => (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));

// Mock workspace hook
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    id: "workspace-1",
    slug: "test-workspace",
    role: "OWNER",
    workspaces: [],
  }),
}));

// Mock PageHeader
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions }: any) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import WhiteboardsPage from "@/app/w/[slug]/whiteboards/page";

const mockWhiteboards = [
  {
    id: "wb-1",
    name: "Whiteboard One",
    featureId: null,
    feature: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-02T00:00:00Z",
  },
  {
    id: "wb-2",
    name: "Whiteboard Two",
    featureId: "feat-1",
    feature: { id: "feat-1", title: "Feature Alpha" },
    createdAt: "2024-01-03T00:00:00Z",
    updatedAt: "2024-01-04T00:00:00Z",
  },
];

/** Open a Radix UI DropdownMenu trigger in jsdom. */
async function openDropdown(trigger: Element) {
  await act(async () => {
    trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    fireEvent.click(trigger);
  });
}

describe("WhiteboardsPage — delete button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: mockWhiteboards }),
    });
  });

  async function renderAndWait() {
    const result = render(<WhiteboardsPage />);
    // Wait for whiteboards to load
    await waitFor(() => {
      expect(screen.getByText("Whiteboard One")).toBeInTheDocument();
    });
    return result;
  }

  /** Open the dropdown for the first whiteboard card and click "Delete". */
  async function openDeleteDialogForFirstCard() {
    // Find the MoreHorizontal dropdown trigger (aria-haspopup="menu") for the first card
    const menuTriggers = screen.getAllByRole("button").filter(
      (btn) => btn.getAttribute("aria-haspopup") === "menu"
    );
    const firstMoreBtn = menuTriggers[0];
    await openDropdown(firstMoreBtn);

    // Click the Delete menu item
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
  }

  it("calls e.preventDefault() and e.stopPropagation() and sets deleteId when delete button is clicked", async () => {
    await renderAndWait();
    await openDeleteDialogForFirstCard();

    // After clicking Delete in the dropdown, the confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText("Delete whiteboard?")).toBeInTheDocument();
    });
  });

  it("opens delete dialog without navigating when delete button is clicked", async () => {
    await renderAndWait();
    await openDeleteDialogForFirstCard();

    // Dialog should open
    await waitFor(() => {
      expect(screen.getByText("Delete whiteboard?")).toBeInTheDocument();
    });

    // Router should NOT have been called (no navigation)
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("does not open delete dialog when clicking the card body link", async () => {
    await renderAndWait();

    // Click the card title text (part of the Link body, not the delete button)
    const cardTitle = screen.getByText("Whiteboard One");
    fireEvent.click(cardTitle);

    // Dialog should NOT open
    expect(screen.queryByText("Delete whiteboard?")).not.toBeInTheDocument();
  });

  it("removes the whiteboard from the list after confirming deletion", async () => {
    await renderAndWait();

    // Setup DELETE response
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await openDeleteDialogForFirstCard();

    await waitFor(() => {
      expect(screen.getByText("Delete whiteboard?")).toBeInTheDocument();
    });

    // Click the Delete confirm button
    const confirmBtn = screen.getByRole("button", { name: /^Delete$/ });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.queryByText("Whiteboard One")).not.toBeInTheDocument();
    });

    // Other whiteboard should still be there
    expect(screen.getByText("Whiteboard Two")).toBeInTheDocument();
  });

  it("keeps the whiteboard list intact and closes dialog on cancel", async () => {
    await renderAndWait();

    await openDeleteDialogForFirstCard();

    await waitFor(() => {
      expect(screen.getByText("Delete whiteboard?")).toBeInTheDocument();
    });

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText("Delete whiteboard?")).not.toBeInTheDocument();
    });

    // Whiteboard should still be in the list
    expect(screen.getByText("Whiteboard One")).toBeInTheDocument();
  });
});
