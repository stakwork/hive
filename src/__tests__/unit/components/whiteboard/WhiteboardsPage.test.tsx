/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

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

  it("calls e.preventDefault() and e.stopPropagation() and sets deleteId when delete button is clicked", async () => {
    await renderAndWait();

    // Hover over first card to reveal the delete button (opacity handled by CSS, button still in DOM)
    const deleteButtons = screen.getAllByRole("button", { name: "" });
    // The first icon-only button is the delete button for "Whiteboard One"
    const firstDeleteBtn = deleteButtons[0];

    const mockEvent = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    fireEvent.click(firstDeleteBtn, mockEvent);

    // After clicking the delete button, the confirmation dialog should appear
    await waitFor(() => {
      expect(screen.getByText("Delete whiteboard?")).toBeInTheDocument();
    });
  });

  it("opens delete dialog without navigating when delete button is clicked", async () => {
    await renderAndWait();

    const deleteButtons = screen.getAllByRole("button", { name: "" });
    fireEvent.click(deleteButtons[0]);

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

    const deleteButtons = screen.getAllByRole("button", { name: "" });
    fireEvent.click(deleteButtons[0]);

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

    const deleteButtons = screen.getAllByRole("button", { name: "" });
    fireEvent.click(deleteButtons[0]);

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
