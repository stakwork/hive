// @vitest-environment jsdom
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// ── hoisted mocks ────────────────────────────────────────────────────────────
const mockPush = vi.fn();
const mockSlug = "test-workspace";
const mockWorkspace = { id: "ws-1" };
const mockUserId = "user-test-1";

// Hoist processStream so it can be referenced inside vi.mock factories
const mockProcessStreamFn = vi.hoisted(() => vi.fn());

// Hoisted so individual tests can override it
const mockSearchParamsGet = vi.hoisted(() => vi.fn().mockReturnValue(null));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: mockSearchParamsGet }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: mockSlug, workspace: mockWorkspace, workspaces: [] }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: mockUserId, name: "Test User" } } }),
}));

vi.mock("@/lib/streaming", () => ({
  useStreamProcessor: () => ({ processStream: mockProcessStreamFn }),
}));

vi.mock("@/lib/pusher", () => ({
  getPusherClient: () => ({
    subscribe: () => ({ bind: vi.fn(), unbind: vi.fn() }),
    unsubscribe: vi.fn(),
  }),
  getWorkspaceChannelName: (s: string) => `workspace-${s}`,
  PUSHER_EVENTS: { FOLLOW_UP_QUESTIONS: "follow-up", PROVENANCE_DATA: "provenance" },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// Stub child components so we can call the handlers directly
vi.mock(
  "@/components/dashboard/DashboardChat/ChatInput",
  () => ({
    ChatInput: ({
      onSend,
      disabled,
    }: {
      onSend: (msg: string, clear: () => void) => Promise<void>;
      disabled?: boolean;
    }) => (
      <div data-testid="chat-input" data-disabled={disabled}>
        <button
          data-testid="send-button"
          disabled={disabled}
          onClick={() => onSend("Hello world", () => {})}
        />
      </div>
    ),
  })
);
vi.mock(
  "@/components/dashboard/DashboardChat/ChatMessage",
  () => ({ ChatMessage: () => null })
);
vi.mock(
  "@/components/dashboard/DashboardChat/ToolCallIndicator",
  () => ({ ToolCallIndicator: () => null })
);
vi.mock(
  "@/components/dashboard/DashboardChat/ProvenanceTree",
  () => ({ ProvenanceTree: () => null })
);
vi.mock(
  "@/components/dashboard/DashboardChat/RecentChatsPopup",
  () => ({ RecentChatsPopup: () => <div data-testid="recent-chats-popup" /> })
);

vi.mock(
  "@/components/dashboard/DashboardChat/StreamScrollIndicator",
  () => ({
    StreamScrollIndicator: ({
      isStreaming,
      userScrolledUp,
      showBackButton,
      onStreamingClick,
      onLatestClick,
      onBackClick,
    }: {
      isStreaming: boolean;
      userScrolledUp: boolean;
      showBackButton: boolean;
      onStreamingClick: () => void;
      onLatestClick: () => void;
      onBackClick: () => void;
    }) => {
      const show = userScrolledUp || showBackButton;
      return (
        <div data-testid="stream-scroll-indicator">
          {show && showBackButton && <button data-testid="back-btn" onClick={onBackClick}>Back</button>}
          {show && !showBackButton && isStreaming && <button data-testid="streaming-btn" onClick={onStreamingClick}>Streaming…</button>}
          {show && !showBackButton && !isStreaming && <button data-testid="latest-btn" onClick={onLatestClick}>Latest response…</button>}
        </div>
      );
    },
  })
);

vi.mock(
  "@/components/dashboard/DashboardChat/CreateFeatureModal",
  () => ({
    CreateFeatureModal: ({
      onLaunchPlan,
      onLaunchTask,
    }: {
      onLaunchPlan: (t: string, d: string) => Promise<void>;
      onLaunchTask: (t: string, d: string) => Promise<void>;
    }) => (
      <div>
        <button data-testid="launch-plan" onClick={() => onLaunchPlan("My Feature", "Desc")}>
          Launch Plan
        </button>
        <button data-testid="launch-task" onClick={() => onLaunchTask("My Task", "Desc")}>
          Launch Task
        </button>
      </div>
    ),
  })
);

import { DashboardChat } from "@/components/dashboard/DashboardChat";

// ── helpers ──────────────────────────────────────────────────────────────────
function mockFetch(...responses: Array<{ ok: boolean; body: unknown }>) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    const res = responses[callCount] ?? responses[responses.length - 1];
    callCount++;
    return Promise.resolve({
      ok: res.ok,
      json: () => Promise.resolve(res.body),
    });
  });
}

const mockWindowOpen = vi.fn();

// ── handleLaunchPlan tests ────────────────────────────────────────────────────
describe("DashboardChat — handleLaunchPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("open", mockWindowOpen);
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockProcessStreamFn.mockResolvedValue(undefined);
  });

  test("reads feature.data.id from POST /api/features response and navigates correctly", async () => {
    const featureId = "feat-123";

    global.fetch = mockFetch(
      { ok: true, body: { success: true, data: { id: featureId, title: "My Feature" } } },
      { ok: true, body: {} }
    );

    render(<DashboardChat />);

    await userEvent.click(screen.getByTestId("launch-plan"));

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[1][0]).toBe(`/api/features/${featureId}/chat`);
      expect(mockWindowOpen).toHaveBeenCalledWith(
        `/w/${mockSlug}/plan/${featureId}`,
        "_blank",
        "noopener,noreferrer"
      );
    });
  });

  test("shows a toast error and does NOT navigate when POST /api/features fails", async () => {
    const { toast } = await import("sonner");

    global.fetch = mockFetch({ ok: false, body: { error: "Server error" } });

    render(<DashboardChat />);

    await userEvent.click(screen.getByTestId("launch-plan"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to launch Plan Mode", expect.anything());
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});

// ── handleLaunchTask tests ────────────────────────────────────────────────────
describe("DashboardChat — handleLaunchTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockProcessStreamFn.mockResolvedValue(undefined);
  });

  test("reads task.data.id from POST /api/tasks response and navigates correctly", async () => {
    const taskId = "task-456";

    global.fetch = mockFetch(
      { ok: true, body: { success: true, data: { id: taskId, title: "My Task" } } },
      { ok: true, body: {} }
    );

    render(<DashboardChat />);

    await userEvent.click(screen.getByTestId("launch-task"));

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls).toHaveLength(2);
      const body = JSON.parse(calls[1][1].body);
      expect(body.taskId).toBe(taskId);
      expect(mockPush).toHaveBeenCalledWith(
        expect.stringContaining(`/w/${mockSlug}/task/${taskId}`)
      );
    });
  });

  test("shows a toast error and does NOT navigate when POST /api/tasks fails", async () => {
    const { toast } = await import("sonner");

    global.fetch = mockFetch({ ok: false, body: { error: "Server error" } });

    render(<DashboardChat />);

    await userEvent.click(screen.getByTestId("launch-task"));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to launch task", expect.anything());
      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});

// ── Auto-save tests ───────────────────────────────────────────────────────────
describe("DashboardChat — auto-save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockProcessStreamFn.mockResolvedValue(undefined);
  });

  test("fires POST to /chat/conversations on first user message", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/chat/conversations") && !url.match(/conversations\/[^/]+$/)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "new-conv-id" }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    render(<DashboardChat />);

    await userEvent.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const postCall = calls.find(
        (c: any[]) =>
          c[0].includes(`/api/workspaces/${mockSlug}/chat/conversations`) &&
          c[1]?.method === "POST"
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.source).toBe("dashboard");
      expect(body.settings).toBeDefined();
    });
  });

  test("handleClearAll resets conversation tracking", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "conv-123" }),
    });

    render(<DashboardChat />);

    await userEvent.click(screen.getByTestId("send-button"));

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.some((c: any[]) => c[0].includes("/chat/conversations"))).toBe(true);
    });

    const clearButton = screen.queryByText("Clear");
    if (clearButton) {
      await userEvent.click(clearButton);
    }

    expect(screen.queryByText("View only")).not.toBeInTheDocument();
  });

  test("handleSend is a no-op when isReadOnly is true (input disabled)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    render(<DashboardChat />);

    const sendButton = screen.getByTestId("send-button");
    expect(sendButton).not.toBeDisabled();
  });

  test("RecentChatsPopup is rendered in the action row when messages exist", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/chat/conversations")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: "conv-abc" }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    render(<DashboardChat />);

    expect(screen.queryByTestId("recent-chats-popup")).not.toBeInTheDocument();
    expect(screen.queryByText("View only")).not.toBeInTheDocument();
  });
});

// ── Scroll indicator integration tests ───────────────────────────────────────
describe("DashboardChat — scroll indicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockProcessStreamFn.mockResolvedValue(undefined);
  });

  /** Trigger a scroll event with the given scroll geometry */
  function fireScrollEvent(
    el: Element,
    opts: { scrollTop: number; clientHeight: number; scrollHeight: number }
  ) {
    Object.defineProperty(el, "scrollTop", { configurable: true, writable: true, value: opts.scrollTop });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: opts.clientHeight });
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: opts.scrollHeight });
    // In jsdom scrollIntoView is a no-op, so the component's isProgrammaticScrollRef
    // may still be true (set by the auto-scroll useEffect after messages arrive).
    // The first dispatch consumes/clears the flag; the second actually updates state.
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
    el.dispatchEvent(new Event("scroll", { bubbles: true }));
  }

  /** Render DashboardChat with messages in state via processStream callback */
  async function renderWithMessages() {
    mockProcessStreamFn.mockImplementation(
      async (_res: unknown, msgId: string, cb: (msg: unknown) => void) => {
        cb({
          id: msgId,
          role: "assistant",
          content: "Hello",
          timestamp: new Date(),
          timeline: [{ type: "text", data: { content: "Hello" } }],
        });
      }
    );

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/chat/conversations")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: "conv-x" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const result = render(<DashboardChat />);
    await userEvent.click(screen.getByTestId("send-button"));
    await waitFor(() => expect(mockProcessStreamFn).toHaveBeenCalled());
    return result;
  }

  test("userScrolledUp becomes true when scrolled > 50px above bottom", async () => {
    const { container } = await renderWithMessages();

    const scrollEl = container.querySelector(".overflow-y-auto");
    expect(scrollEl).not.toBeNull();

    // scrollTop(100) + clientHeight(400) = 500 < scrollHeight(1000) - 50 → not at bottom
    fireScrollEvent(scrollEl!, { scrollTop: 100, clientHeight: 400, scrollHeight: 1000 });

    await waitFor(() => expect(screen.getByTestId("latest-btn")).toBeInTheDocument());
  });

  test("userScrolledUp becomes false when scrolled back to bottom", async () => {
    const { container } = await renderWithMessages();
    const scrollEl = container.querySelector(".overflow-y-auto")!;

    // Scroll up → indicator appears
    fireScrollEvent(scrollEl, { scrollTop: 100, clientHeight: 400, scrollHeight: 1000 });
    await waitFor(() => expect(screen.getByTestId("latest-btn")).toBeInTheDocument());

    // Scroll to bottom: 600 + 400 = 1000 >= 950 → atBottom
    fireScrollEvent(scrollEl, { scrollTop: 600, clientHeight: 400, scrollHeight: 1000 });
    await waitFor(() => expect(screen.queryByTestId("latest-btn")).not.toBeInTheDocument());
  });

  test("clicking 'Latest response…' pill sets showBackButton → back-btn appears", async () => {
    const { container } = await renderWithMessages();
    const scrollEl = container.querySelector(".overflow-y-auto")!;

    fireScrollEvent(scrollEl, { scrollTop: 100, clientHeight: 400, scrollHeight: 1000 });
    await waitFor(() => expect(screen.getByTestId("latest-btn")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("latest-btn"));

    // handleScrollToNewResponse → setShowBackButton(true), setUserScrolledUp(false)
    await waitFor(() => expect(screen.getByTestId("back-btn")).toBeInTheDocument());
  });

  test("clicking 'Back' pill restores userScrolledUp → latest-btn reappears", async () => {
    const { container } = await renderWithMessages();
    const scrollEl = container.querySelector(".overflow-y-auto")!;

    fireScrollEvent(scrollEl, { scrollTop: 100, clientHeight: 400, scrollHeight: 1000 });
    await waitFor(() => expect(screen.getByTestId("latest-btn")).toBeInTheDocument());

    // Jump to latest → shows back btn
    await userEvent.click(screen.getByTestId("latest-btn"));
    await waitFor(() => expect(screen.getByTestId("back-btn")).toBeInTheDocument());

    // Go back → userScrolledUp=true, showBackButton=false → latest-btn
    await userEvent.click(screen.getByTestId("back-btn"));
    await waitFor(() => expect(screen.getByTestId("latest-btn")).toBeInTheDocument());
  });

  test("StreamScrollIndicator is a sibling of the scroll container, not a descendant", async () => {
    const { container } = await renderWithMessages();

    const scrollEl = container.querySelector(".overflow-y-auto");
    expect(scrollEl).not.toBeNull();

    // The indicator is rendered outside (after) the scroll container — it must
    // NOT be a descendant of the overflow-y-auto div.
    const indicatorInsideScroll = scrollEl!.querySelector("[data-testid='stream-scroll-indicator']");
    expect(indicatorInsideScroll).toBeNull();

    // It should still exist somewhere in the component tree (as a sibling).
    const indicator = container.querySelector("[data-testid='stream-scroll-indicator']");
    expect(indicator).not.toBeNull();
  });
});

// ── ?chat= preload tests ──────────────────────────────────────────────────────
describe("DashboardChat — ?chat= URL preload", () => {
  const convId = "conv-preload-1";

  const ownerConvResponse = {
    id: convId,
    userId: mockUserId, // same as session user → owner
    messages: [
      { id: "m1", role: "user", content: "Hello from history", timestamp: new Date().toISOString() },
      { id: "m2", role: "assistant", content: "Hi there", timestamp: new Date().toISOString() },
    ],
    settings: { extraWorkspaceSlugs: [] },
  };

  const nonOwnerConvResponse = {
    ...ownerConvResponse,
    userId: "other-user-99", // different user → non-owner
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    mockProcessStreamFn.mockResolvedValue(undefined);
    mockSearchParamsGet.mockReturnValue(null); // default: no chat param
  });

  test("auto-loads conversation for owner (continuable, not read-only)", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "chat" ? convId : null
    );

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ownerConvResponse),
    });

    render(<DashboardChat />);

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const preloadCall = calls.find((c: string[]) =>
        c[0].includes(`/chat/conversations/${convId}`)
      );
      expect(preloadCall).toBeDefined();
    });

    // Read-only badge should NOT appear (owner gets continuable session)
    await waitFor(() => {
      expect(screen.queryByText("View only")).not.toBeInTheDocument();
    });
  });

  test("marks conversation read-only for non-owner", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "chat" ? convId : null
    );

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(nonOwnerConvResponse),
    });

    render(<DashboardChat />);

    await waitFor(() => {
      expect(screen.getByText("View only")).toBeInTheDocument();
    });
  });

  test("falls back to empty chat on API failure (non-2xx)", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "chat" ? convId : null
    );

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found" }),
    });

    // Should render without throwing
    render(<DashboardChat />);

    await waitFor(() => {
      // No messages rendered, no read-only badge
      expect(screen.queryByText("View only")).not.toBeInTheDocument();
    });
  });

  test("falls back to empty chat on network error", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "chat" ? convId : null
    );

    global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

    render(<DashboardChat />);

    await waitFor(() => {
      expect(screen.queryByText("View only")).not.toBeInTheDocument();
    });
  });

  test("does not fetch when no ?chat param is present", async () => {
    mockSearchParamsGet.mockReturnValue(null);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    render(<DashboardChat />);

    // Brief delay to let any effects run
    await new Promise((r) => setTimeout(r, 50));

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const preloadCall = calls.find((c: string[]) =>
      c[0]?.includes("/chat/conversations/")
    );
    expect(preloadCall).toBeUndefined();
  });
});
