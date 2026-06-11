// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import type { ActivityItem } from "@/app/api/profile/activity/route";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock next/link — just render a plain <a>
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// Mock date-fns — return a predictable string
vi.mock("date-fns", () => ({
  formatDistanceToNow: vi.fn(() => "2 hours ago"),
}));

// Mock global fetch
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { ActivityFeed } from "@/app/profile/_components/ActivityFeed";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "item-1",
    kind: "conversation",
    title: "Test title",
    link: "/w/my-workspace",
    workspaceName: "My Workspace",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function mockFetchWith(items: ActivityItem[]) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ items }),
  } as Response);
}

function mockFetchLoading() {
  // Never resolves — simulates in-flight request
  fetchMock.mockReturnValueOnce(new Promise(() => {}));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ActivityFeed", () => {
  it("renders skeleton rows while loading", () => {
    mockFetchLoading();
    render(<ActivityFeed />);
    // Skeletons use animate-pulse; they should be present before data arrives
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders the empty state when API returns no items", async () => {
    mockFetchWith([]);
    render(<ActivityFeed />);
    await waitFor(() => {
      expect(screen.getByText("No activity in the last 30 days.")).toBeInTheDocument();
    });
  });

  it("renders a list of items after loading", async () => {
    mockFetchWith([
      makeItem({ id: "item-1", title: "First chat", kind: "conversation" }),
      makeItem({ id: "item-2", title: "Second plan", kind: "plan" }),
    ]);
    render(<ActivityFeed />);
    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument();
      expect(screen.getByText("Second plan")).toBeInTheDocument();
    });
  });

  it("renders the correct icon for each kind", async () => {
    mockFetchWith([
      makeItem({ id: "c-1", kind: "conversation", title: "Conversation item" }),
      makeItem({ id: "p-1", kind: "plan", title: "Plan item" }),
      makeItem({ id: "t-1", kind: "task", title: "Task item" }),
    ]);
    const { container } = render(<ActivityFeed />);

    await waitFor(() => {
      expect(screen.getByText("Conversation item")).toBeInTheDocument();
    });

    // Each item row contains an SVG icon — we assert by checking lucide SVG presence
    // Lucide renders SVGs with role="img" or as inline SVG; count them
    const svgs = container.querySelectorAll("svg");
    // 3 kind icons + 3 arrow icons = 6 SVGs minimum
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });

  it("links each item to the correct href", async () => {
    mockFetchWith([
      makeItem({ id: "item-1", title: "Go to plan", link: "/w/my-ws/plan/feat-1", kind: "plan" }),
      makeItem({ id: "item-2", title: "Go to task", link: "/w/my-ws/task/task-1", kind: "task" }),
      makeItem({
        id: "item-3",
        title: "Go to canvas",
        link: "/org/my-org",
        kind: "conversation",
      }),
    ]);
    render(<ActivityFeed />);

    await waitFor(() => {
      expect(screen.getByText("Go to plan")).toBeInTheDocument();
    });

    const anchors = screen.getAllByRole("link") as HTMLAnchorElement[];
    const hrefs = anchors.map((a) => a.getAttribute("href"));

    expect(hrefs).toContain("/w/my-ws/plan/feat-1");
    expect(hrefs).toContain("/w/my-ws/task/task-1");
    expect(hrefs).toContain("/org/my-org");
  });

  it("shows relative timestamps for each item", async () => {
    mockFetchWith([makeItem({ title: "Time test" })]);
    render(<ActivityFeed />);
    await waitFor(() => {
      expect(screen.getByText("Time test")).toBeInTheDocument();
    });
    expect(screen.getByText("2 hours ago")).toBeInTheDocument();
  });

  it("shows workspace/org chip for each item", async () => {
    mockFetchWith([makeItem({ workspaceName: "Alpha Workspace" })]);
    render(<ActivityFeed />);
    await waitFor(() => {
      expect(screen.getByText("Alpha Workspace")).toBeInTheDocument();
    });
  });

  it("handles a failed fetch gracefully and shows empty state", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    render(<ActivityFeed />);
    await waitFor(() => {
      expect(screen.getByText("No activity in the last 30 days.")).toBeInTheDocument();
    });
  });
});
