import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalSearch } from "@/components/GlobalSearch";

// Mock Next.js router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock useWorkspace
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { slug: "test-slug", id: "ws-1", name: "Test Workspace" },
  }),
}));

// Mock command palette UI primitives (use real implementations via passthrough)
// The @/components/ui/command module uses Radix under the hood; render it in a jsdom context.
// We don't need to mock it — just let it render normally.

describe("GlobalSearch", () => {
  beforeEach(() => {
    mockPush.mockClear();
    // jsdom does not implement scrollIntoView; cmdk calls it internally
    Element.prototype.scrollIntoView = vi.fn();
  });

  const openPalette = async () => {
    render(<GlobalSearch />);
    // Trigger Cmd+K to open the palette
    await userEvent.keyboard("{Meta>}k{/Meta}");
  };

  test("shows Quick Create group and New Feature item when palette opens with empty query", async () => {
    await openPalette();

    expect(screen.getByText("Quick Create")).toBeInTheDocument();
    expect(screen.getByText("New Feature")).toBeInTheDocument();
  });

  test("navigates to /w/[slug]/plan/new and closes palette when New Feature is selected", async () => {
    await openPalette();

    const newFeatureItem = screen.getByText("New Feature");
    await userEvent.click(newFeatureItem);

    expect(mockPush).toHaveBeenCalledWith("/w/test-slug/plan/new");
    // After selection the palette should close (New Feature item no longer visible)
    expect(screen.queryByText("New Feature")).not.toBeInTheDocument();
  });

  test("Quick Create group remains visible alongside search results when query is active", async () => {
    // Mock fetch to return empty results so we don't need a real API
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { tasks: [], features: [], phases: [] } }),
    });

    await openPalette();

    // Type a search query
    const input = screen.getByPlaceholderText("Search...");
    await userEvent.type(input, "my query");

    // Quick Create group must still be visible
    expect(screen.getByText("Quick Create")).toBeInTheDocument();
    expect(screen.getByText("New Feature")).toBeInTheDocument();
  });
});
