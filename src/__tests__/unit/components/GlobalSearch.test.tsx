import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalSearch } from "@/components/GlobalSearch";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: { slug: "test-ws" } }),
}));

// cmdk calls scrollIntoView internally; jsdom doesn't implement it
Element.prototype.scrollIntoView = vi.fn();

// Keep the dialog open by default — GlobalSearch controls its own open state via keyboard
// so we force it open by firing the keyboard shortcut after render
async function renderAndOpen() {
  render(<GlobalSearch />);
  // Simulate Cmd+K to open the palette (wrapped in act so React processes the state update)
  await act(async () => {
    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true });
    document.dispatchEvent(event);
  });
}

describe("GlobalSearch – Quick Create section", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows all three Quick Create items when palette is open", async () => {
    await renderAndOpen();
    expect(screen.getByText("New Feature")).toBeInTheDocument();
    expect(screen.getByText("New Task")).toBeInTheDocument();
    expect(screen.getByText("New Whiteboard")).toBeInTheDocument();
  });

  it("navigates to /w/test-ws/plan/new when New Feature is selected", async () => {
    const user = userEvent.setup();
    await renderAndOpen();
    await user.click(screen.getByText("New Feature"));
    expect(mockPush).toHaveBeenCalledWith("/w/test-ws/plan/new");
  });

  it("navigates to /w/test-ws/task/new when New Task is selected", async () => {
    const user = userEvent.setup();
    await renderAndOpen();
    await user.click(screen.getByText("New Task"));
    expect(mockPush).toHaveBeenCalledWith("/w/test-ws/task/new");
  });

  it("navigates to /w/test-ws/whiteboards when New Whiteboard is selected", async () => {
    const user = userEvent.setup();
    await renderAndOpen();
    await user.click(screen.getByText("New Whiteboard"));
    expect(mockPush).toHaveBeenCalledWith("/w/test-ws/whiteboards");
  });
});
