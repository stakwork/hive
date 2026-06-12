// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ActivityItem } from "@/app/api/profile/activity/route";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock next/link — render a plain <a> passing through all attributes
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    target,
    rel,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    target?: string;
    rel?: string;
  }) => (
    <a href={href} className={className} target={target} rel={rel}>
      {children}
    </a>
  ),
}));

// Mock date-fns — return a predictable string
vi.mock("date-fns", () => ({
  formatDistanceToNow: vi.fn(() => "2 hours ago"),
}));

// Mock usePusherChannel — returns null by default (Pusher not configured)
vi.mock("@/hooks/usePusherChannel", () => ({
  usePusherChannel: vi.fn(() => null),
  __resetUsePusherChannelForTests: vi.fn(),
}));

// Mock pusher exports
vi.mock("@/lib/pusher", () => ({
  getUserChannelName: vi.fn((userId: string) => `user-${userId}`),
  PUSHER_EVENTS: { ACTIVITY_UPDATED: "activity-updated" },
}));

// Mock global fetch
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

// Mock IntersectionObserver
let intersectionCallback: ((entries: IntersectionObserverEntry[]) => void) | null = null;
const observeMock = vi.fn();
const disconnectMock = vi.fn();

const MockIntersectionObserver = vi.fn(
  (callback: (entries: IntersectionObserverEntry[]) => void) => {
    intersectionCallback = callback;
    return { observe: observeMock, disconnect: disconnectMock, unobserve: vi.fn() };
  }
);
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

// Import after mocks
import { ActivityFeed } from "@/app/profile/_components/ActivityFeed";
import { usePusherChannel } from "@/hooks/usePusherChannel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "item-1",
    kind: "conversation",
    category: "chat",
    action: "active",
    title: "Test title",
    link: "/w/my-workspace",
    workspaceName: "My Workspace",
    timestamp: new Date().toISOString(),
    completed: false,
    ...overrides,
  };
}

function mockFetchWith(items: ActivityItem[], nextCursor: string | null = null) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ items, nextCursor }),
  } as Response);
}

function mockFetchLoading() {
  // Never resolves — simulates in-flight request
  fetchMock.mockReturnValueOnce(new Promise(() => {}));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the fetch queue so unconsumed once-values don't bleed between tests
  fetchMock.mockReset();
  intersectionCallback = null;
  // Default: usePusherChannel returns null (no Pusher configured)
  vi.mocked(usePusherChannel).mockReturnValue(null);
});

afterEach(() => {
  // Safety: always restore real timers in case a test used fake ones
  vi.useRealTimers();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ActivityFeed", () => {
  // ── Loading / basic rendering ──────────────────────────────────────────────

  it("renders skeleton rows while loading", () => {
    mockFetchLoading();
    render(<ActivityFeed userId="user-1" />);
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders the empty state when API returns no items", async () => {
    mockFetchWith([]);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByText("No activity in the last 30 days.")).toBeInTheDocument();
    });
  });

  it("renders a list of items after loading", async () => {
    mockFetchWith([
      makeItem({ id: "item-1", title: "First chat", kind: "conversation" }),
      makeItem({ id: "item-2", title: "Second plan", kind: "plan" }),
    ]);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByText("First chat")).toBeInTheDocument();
      expect(screen.getByText("Second plan")).toBeInTheDocument();
    });
  });

  it("handles a failed fetch gracefully and shows empty state", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => {
      expect(screen.getByText("No activity in the last 30 days.")).toBeInTheDocument();
    });
  });

  // ── New-tab links ──────────────────────────────────────────────────────────

  it("renders rows with target=_blank and rel=noopener noreferrer", async () => {
    mockFetchWith([
      makeItem({ id: "item-1", title: "Go to plan", link: "/w/my-ws/plan/feat-1" }),
      makeItem({ id: "item-2", title: "Go to task", link: "/w/my-ws/task/task-1" }),
    ]);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("Go to plan"));

    const anchors = screen.getAllByRole("link") as HTMLAnchorElement[];
    for (const a of anchors) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  // ── Workspace-first label ──────────────────────────────────────────────────

  it("shows workspaceName and no org icon when both present", async () => {
    mockFetchWith([makeItem({ workspaceName: "My Workspace", orgName: "my-org" })]);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("My Workspace"));
    expect(screen.getByText("My Workspace")).toBeInTheDocument();
    expect(screen.queryByText("my-org")).not.toBeInTheDocument();
    expect(screen.queryByTestId("org-icon")).not.toBeInTheDocument();
  });

  it("falls back to orgName when workspaceName is absent and shows org icon", async () => {
    mockFetchWith([makeItem({ workspaceName: "", orgName: "fallback-org" })]);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("fallback-org"));
    expect(screen.getByText("fallback-org")).toBeInTheDocument();
    expect(screen.getByTestId("org-icon")).toBeInTheDocument();
  });

  // ── Action badge ──────────────────────────────────────────────────────────

  it("shows 'Created' badge when item.action === 'created'", async () => {
    mockFetchWith([makeItem({ id: "c-1", title: "New task", action: "created", kind: "task" })]);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("New task"));
    expect(screen.getByText("Created")).toBeInTheDocument();
  });

  it("does not show 'Created' badge when item.action === 'active'", async () => {
    mockFetchWith([makeItem({ id: "a-1", title: "Active task", action: "active", kind: "task" })]);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("Active task"));
    expect(screen.queryByText("Created")).not.toBeInTheDocument();
  });

  // ── Search bar ────────────────────────────────────────────────────────────

  it("renders a search input", async () => {
    mockFetchWith([]);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByPlaceholderText("Search activity…"));
    expect(screen.getByPlaceholderText("Search activity…")).toBeInTheDocument();
  });

  it("shows a clear button when query is non-empty", async () => {
    mockFetchWith([]); // initial load
    render(<ActivityFeed userId="user-1" />);
    const input = await screen.findByPlaceholderText("Search activity…");

    expect(screen.queryByLabelText("Clear search")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.change(input, { target: { value: "hello" } });
    });
    expect(screen.getByLabelText("Clear search")).toBeInTheDocument();
  });

  it("clicking the clear button resets the query", async () => {
    // Provide open-ended mock so any number of fetches (initial + debounce) succeed
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null }),
    } as Response);

    render(<ActivityFeed userId="user-1" />);
    const input = await screen.findByPlaceholderText("Search activity…");

    await act(async () => {
      fireEvent.change(input, { target: { value: "hello" } });
    });

    const clearBtn = screen.getByLabelText("Clear search");
    await act(async () => {
      fireEvent.click(clearBtn);
    });

    expect((input as HTMLInputElement).value).toBe("");
    expect(screen.queryByLabelText("Clear search")).not.toBeInTheDocument();
  });

  it("debounced query triggers fetch with q= parameter", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null }),
    } as Response);

    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText("Search activity…");
    fireEvent.change(input, { target: { value: "myquery" } });

    // Wait up to 2s for the 300ms debounce + fetch to fire
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 2000 });

    const lastUrl = fetchMock.mock.calls[1][0] as string;
    expect(lastUrl).toContain("q=myquery");
  });

  it("shows no-results empty state with query text", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null }),
    } as Response);

    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByPlaceholderText("Search activity…"));

    const input = screen.getByPlaceholderText("Search activity…");
    fireEvent.change(input, { target: { value: "foobar" } });

    await waitFor(
      () => expect(screen.getByText(/No activity matching "foobar"/i)).toBeInTheDocument(),
      { timeout: 2000 }
    );
  });

  // ── Category chips ────────────────────────────────────────────────────────

  it("renders All, Tasks, Plans, Chats chips", async () => {
    mockFetchWith([]);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("All"));
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Plans")).toBeInTheDocument();
    expect(screen.getByText("Chats")).toBeInTheDocument();
  });

  it("clicking a category chip triggers fetch with category= param", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null }),
    } as Response);

    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("Tasks"));

    await act(async () => {
      await userEvent.click(screen.getByText("Tasks"));
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const lastUrl = fetchMock.mock.calls[1][0] as string;
    expect(lastUrl).toContain("category=task");
  });

  it("category and search compose on fetch", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null }),
    } as Response);

    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("Tasks"));

    // Click category chip
    await act(async () => {
      await userEvent.click(screen.getByText("Tasks"));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Then type in search (debounced)
    const input = screen.getByPlaceholderText("Search activity…");
    fireEvent.change(input, { target: { value: "search" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 2000 });

    const lastUrl = fetchMock.mock.calls[2][0] as string;
    expect(lastUrl).toContain("category=task");
    expect(lastUrl).toContain("q=search");
  });

  it("shows per-category empty state text", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], nextCursor: null }),
    } as Response);

    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("Plans"));

    await act(async () => {
      await userEvent.click(screen.getByText("Plans"));
    });

    await waitFor(() =>
      expect(screen.getByText("No plans activity in the last 30 days.")).toBeInTheDocument()
    );
  });

  // ── Infinite scroll ───────────────────────────────────────────────────────

  it("appends items when sentinel becomes visible and nextCursor exists", async () => {
    const page1 = [makeItem({ id: "i-1", title: "Item 1" })];
    const page2 = [makeItem({ id: "i-2", title: "Item 2" })];

    mockFetchWith(page1, "cursor-abc"); // page 1 with cursor
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("Item 1"));

    // Wait for the IntersectionObserver effect to re-register with the updated
    // nextCursor in its closure (effect re-runs when nextCursor state changes).
    // Without this, CI may invoke the stale callback (nextCursor=null) that
    // short-circuits the guard and never fetches page 2.
    await waitFor(() => expect(observeMock).toHaveBeenCalledTimes(2));

    // Simulate sentinel intersection to trigger next page
    mockFetchWith(page2, null);
    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry]);
    });

    await waitFor(() => {
      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.getByText("Item 2")).toBeInTheDocument();
    });
  });

  it("shows exhausted state when nextCursor is null after fetch", async () => {
    mockFetchWith([makeItem({ id: "i-1", title: "Only item" })], null);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("Only item"));
    await waitFor(() =>
      expect(screen.getByText(/You're all caught up/i)).toBeInTheDocument()
    );
  });

  it("does not show exhausted state when items list is empty", async () => {
    mockFetchWith([], null);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() =>
      expect(screen.getByText("No activity in the last 30 days.")).toBeInTheDocument()
    );
    expect(screen.queryByText(/You're all caught up/i)).not.toBeInTheDocument();
  });

  it("does not load more when already exhausted", async () => {
    const page1 = [makeItem({ id: "i-1", title: "Item 1" })];
    mockFetchWith(page1, null); // no next cursor → exhausted
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("Item 1"));

    // Trigger intersection — should NOT call fetchPage again since exhausted
    await act(async () => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry]);
    });

    // Still only 1 fetch call (the initial load)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── Pusher live updates ───────────────────────────────────────────────────

  it("ACTIVITY_UPDATED event triggers page-1 refetch and prepends new items", async () => {
    let boundHandler: (() => void) | null = null;
    const mockChan = {
      bind: vi.fn((event: string, fn: () => void) => {
        boundHandler = fn;
      }),
      unbind: vi.fn(),
    };
    vi.mocked(usePusherChannel).mockReturnValue(mockChan as never);

    const initial = [makeItem({ id: "existing", title: "Existing item" })];
    mockFetchWith(initial, null); // initial load

    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("Existing item"));

    // Simulate Pusher ACTIVITY_UPDATED event bringing a new item
    const fresh = [
      makeItem({ id: "new-item", title: "Brand new item" }),
      makeItem({ id: "existing", title: "Existing item" }), // already present → deduped
    ];
    mockFetchWith(fresh, null);

    await act(async () => {
      boundHandler?.();
    });

    await waitFor(() => {
      expect(screen.getByText("Brand new item")).toBeInTheDocument();
      expect(screen.getByText("Existing item")).toBeInTheDocument();
    });

    // "existing" must not be duplicated
    expect(screen.getAllByText("Existing item")).toHaveLength(1);
  });

  it("silently ignores Pusher when channel is null", async () => {
    vi.mocked(usePusherChannel).mockReturnValue(null);
    mockFetchWith([makeItem({ id: "i1", title: "Test item" })], null);
    render(<ActivityFeed userId="user-1" />);
    await waitFor(() => screen.getByText("Test item"));
    // No error thrown — channel=null is handled gracefully
  });

  // ── Strikethrough for completed items ─────────────────────────────────────

  it("completed task renders title with line-through class", async () => {
    mockFetchWith([
      makeItem({ id: "t1", kind: "task", category: "task", title: "Done task", completed: true }),
    ]);
    render(<ActivityFeed userId="user-1" />);
    const title = await screen.findByText("Done task");
    expect(title.className).toContain("line-through");
  });

  it("completed plan renders title with line-through class", async () => {
    mockFetchWith([
      makeItem({ id: "p1", kind: "plan", category: "plan", title: "Done plan", completed: true }),
    ]);
    render(<ActivityFeed userId="user-1" />);
    const title = await screen.findByText("Done plan");
    expect(title.className).toContain("line-through");
  });

  it("completed conversation does NOT render title with line-through", async () => {
    mockFetchWith([
      makeItem({ id: "c1", kind: "conversation", category: "chat", title: "Done chat", completed: true }),
    ]);
    render(<ActivityFeed userId="user-1" />);
    const title = await screen.findByText("Done chat");
    expect(title.className).not.toContain("line-through");
  });

  it("non-completed task does NOT render title with line-through", async () => {
    mockFetchWith([
      makeItem({ id: "t2", kind: "task", category: "task", title: "Active task", completed: false }),
    ]);
    render(<ActivityFeed userId="user-1" />);
    const title = await screen.findByText("Active task");
    expect(title.className).not.toContain("line-through");
  });
});
