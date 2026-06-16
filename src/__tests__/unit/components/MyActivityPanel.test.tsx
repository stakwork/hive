// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActivityItem } from "@/app/api/profile/activity/route";

// ── Mocks ────────────────────────────────────────────────────────────────────

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

vi.mock("date-fns", () => ({
  formatDistanceToNow: vi.fn(() => "2 hours ago"),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const openMock = vi.fn();
vi.stubGlobal("open", openMock);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "item-1",
    kind: "task",
    category: "task",
    action: "created",
    title: "Fix the login bug",
    link: "/w/workspace/tasks/task-1",
    workspaceName: "my-workspace",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2h ago
    completed: false,
    ...overrides,
  };
}

function makeApiResponse(items: ActivityItem[]) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ items, nextCursor: null }),
  });
}

// ── Import (after mocks) ──────────────────────────────────────────────────────

const { MyActivityPanel } = await import(
  "@/app/org/[githubLogin]/_components/MyActivityPanel"
);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MyActivityPanel", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    openMock.mockReset();
    // Default: any fetch returns the initial items (for re-fetch on filter change)
    fetchMock.mockImplementation(() => makeApiResponse([]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Rendering ──────────────────────────────────────────────────────────────

  it("renders initialItems on mount", () => {
    const items = [
      makeItem({ id: "a", title: "Task Alpha" }),
      makeItem({ id: "b", title: "Chat Beta", kind: "conversation", category: "chat" }),
    ];

    render(<MyActivityPanel initialItems={items} />);

    expect(screen.getByText("Task Alpha")).toBeInTheDocument();
    expect(screen.getByText("Chat Beta")).toBeInTheDocument();
  });

  it("renders the 'My Activity' header", () => {
    render(<MyActivityPanel initialItems={[makeItem()]} />);
    expect(screen.getByText("My Activity")).toBeInTheDocument();
  });

  it("renders a 'View all' link pointing to /profile", () => {
    render(<MyActivityPanel initialItems={[makeItem()]} />);
    const link = screen.getByRole("link", { name: /view all/i });
    expect(link).toHaveAttribute("href", "/profile");
  });

  it("shows relative time for each item", () => {
    render(<MyActivityPanel initialItems={[makeItem()]} />);
    expect(screen.getByText("2 hours ago")).toBeInTheDocument();
  });

  it("shows workspace name for each item", () => {
    render(<MyActivityPanel initialItems={[makeItem({ workspaceName: "acme-corp" })]} />);
    expect(screen.getByText("acme-corp")).toBeInTheDocument();
  });

  it("applies strikethrough styling for completed items", () => {
    render(<MyActivityPanel initialItems={[makeItem({ completed: true, title: "Done task" })]} />);
    const title = screen.getByText("Done task");
    expect(title.className).toMatch(/line-through/);
  });

  // ── Empty state ────────────────────────────────────────────────────────────

  it("shows empty state when initialItems is empty", async () => {
    render(<MyActivityPanel initialItems={[]} />);
    // After mount effect fires (with empty items from fetch), empty state appears
    await waitFor(() =>
      expect(screen.getByText(/no recent activity/i)).toBeInTheDocument(),
    );
  });

  it("shows search-aware empty state when query is active", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockImplementation(() => makeApiResponse([]));

    render(<MyActivityPanel initialItems={[makeItem()]} />);

    const input = screen.getByPlaceholderText(/search activity/i);
    fireEvent.change(input, { target: { value: "xyz" } });

    // Advance past debounce (300 ms)
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    await waitFor(() =>
      expect(screen.getByText(/no matching activity/i)).toBeInTheDocument(),
    );
  });

  // ── Dismiss ────────────────────────────────────────────────────────────────

  it("calls onDismiss when × button is clicked", async () => {
    const onDismiss = vi.fn();
    render(<MyActivityPanel initialItems={[makeItem()]} onDismiss={onDismiss} />);

    const dismissBtn = screen.getByTitle(/hide for this session/i);
    await userEvent.click(dismissBtn);

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not render dismiss button when onDismiss is not provided", () => {
    render(<MyActivityPanel initialItems={[makeItem()]} />);
    expect(screen.queryByTitle(/hide for this session/i)).not.toBeInTheDocument();
  });

  // ── Item click → new tab ──────────────────────────────────────────────────

  it("opens item link in a new tab when clicked", async () => {
    const item = makeItem({ link: "/w/ws/tasks/t1", title: "Open me" });
    render(<MyActivityPanel initialItems={[item]} />);

    const row = screen.getByRole("button", { name: /open me/i });
    await userEvent.click(row);

    expect(openMock).toHaveBeenCalledWith(
      "/w/ws/tasks/t1",
      "_blank",
      "noopener,noreferrer",
    );
  });

  // ── Search debounce re-fetch ──────────────────────────────────────────────

  it("re-fetches with ?q= param after debounce", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const freshItems = [makeItem({ id: "fresh", title: "Fresh Result" })];
    fetchMock.mockImplementation(() => makeApiResponse(freshItems));

    render(<MyActivityPanel initialItems={[makeItem()]} />);

    const input = screen.getByPlaceholderText(/search activity/i);
    fireEvent.change(input, { target: { value: "fresh" } });

    // Before debounce fires — no extra fetch
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("q=fresh"),
    );

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(calls.some((url) => url.includes("q=fresh"))).toBe(true);
    });

    await waitFor(() =>
      expect(screen.getByText("Fresh Result")).toBeInTheDocument(),
    );
  });

  it("shows clear × button in search when query is non-empty, and clears on click", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MyActivityPanel initialItems={[makeItem()]} />);

    const input = screen.getByPlaceholderText(/search activity/i);
    fireEvent.change(input, { target: { value: "hello" } });

    const clearBtn = screen.getByLabelText(/clear search/i);
    expect(clearBtn).toBeInTheDocument();

    await userEvent.click(clearBtn);
    expect((input as HTMLInputElement).value).toBe("");
  });

  // ── Category chip re-fetch ─────────────────────────────────────────────────

  it("re-fetches with ?category= param when a chip is clicked", async () => {
    const taskItems = [makeItem({ id: "t1", title: "A Task Item" })];
    fetchMock.mockImplementation(() => makeApiResponse(taskItems));

    render(<MyActivityPanel initialItems={[makeItem()]} />);

    const tasksChip = screen.getByRole("button", { name: "Tasks" });
    await userEvent.click(tasksChip);

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => c[0] as string);
      expect(calls.some((url) => url.includes("category=task"))).toBe(true);
    });

    await waitFor(() =>
      expect(screen.getByText("A Task Item")).toBeInTheDocument(),
    );
  });

  it("highlights the active category chip", async () => {
    render(<MyActivityPanel initialItems={[makeItem()]} />);

    const plansChip = screen.getByRole("button", { name: "Plans" });
    await userEvent.click(plansChip);

    // Active chip should have primary styling
    expect(plansChip.className).toMatch(/bg-primary/);
  });
});
