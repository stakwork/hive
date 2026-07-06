// @vitest-environment jsdom
/**
 * Unit tests for the SidebarChat component header activity indicator.
 *
 * Focuses on:
 * 1. Renders pulsing amber dot when useCanvasAgentActivity returns isActive: true
 * 2. Does not render the dot when isActive: false
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

// jsdom does not implement scrollIntoView — install a no-op globally so
// the SidebarChat scroll effect never throws. Scroll behaviour tests
// override this with a tracked mock in their own beforeEach.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

// ── Activity indicator hook mock ──────────────────────────────────────────────
let mockIsActive = false;
vi.mock("@/hooks/useCanvasAgentActivity", () => ({
  useCanvasAgentActivity: () => ({ isActive: mockIsActive }),
}));

// ── Workspace hook mock ───────────────────────────────────────────────────────
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ id: "ws-1" }),
}));

// ── Canvas chat store mock ────────────────────────────────────────────────────
// Default store state — overridden in scroll tests
let mockStoreState = {
  activeConversationId: null as string | null,
  conversations: {} as Record<string, unknown>,
  artifacts: {} as Record<string, unknown>,
  dismissedArtifactIds: {} as Record<string, boolean>,
  pendingInputDraft: null as string | null,
};

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector(mockStoreState),
  ),
}));

vi.mock("@/app/org/[githubLogin]/_state/useSendCanvasChatMessage", () => ({
  useSendCanvasChatMessage: () => vi.fn(),
}));

// ── Sub-component mocks ───────────────────────────────────────────────────────
vi.mock("@/app/org/[githubLogin]/_components/CanvasHistoryPopover", () => ({
  CanvasHistoryPopover: () => null,
}));
vi.mock("@/app/org/[githubLogin]/_components/CanvasAgentSettingsPopover", () => ({
  CanvasAgentSettingsPopover: () => null,
}));
vi.mock("@/app/org/[githubLogin]/_components/SidebarChatMessage", () => ({
  SidebarChatMessage: () => null,
}));
vi.mock("@/app/org/[githubLogin]/_components/ProposalCard", () => ({
  ProposalCard: () => null,
  getProposalsFromMessage: () => [],
}));
vi.mock("@/app/org/[githubLogin]/_components/SubAgentRunCard", () => ({
  SubAgentRunCard: () => null,
  getSubAgentRunsFromMessages: () => [],
}));
vi.mock("@/app/org/[githubLogin]/_components/ResearchRunCard", () => ({
  ResearchRunCard: () => null,
  getResearchRunsFromMessages: () => [],
}));
vi.mock("@/app/org/[githubLogin]/_components/PlannerFormSlot", () => ({
  PlannerFormSlot: () => null,
}));
vi.mock("@/app/org/[githubLogin]/_components/StartTasksSlot", () => ({
  StartTasksSlot: () => null,
}));
vi.mock("@/app/org/[githubLogin]/_components/AttentionList", () => ({
  AttentionList: () => null,
}));

vi.mock("@/components/streaming", () => ({
  StreamingMessage: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: React.ReactNode;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({
    children,
    asChild,
    ...rest
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  } & React.HTMLAttributes<HTMLSpanElement>) =>
    asChild ? <>{children}</> : <span {...rest}>{children}</span>,
}));

vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({
    isListening: false,
    transcript: "",
    isSupported: false,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    resetTranscript: vi.fn(),
  }),
}));

vi.mock("@/lib/upload-image-to-s3", () => ({
  uploadFileToS3: vi.fn(),
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: React.forwardRef(
    (
      {
        children,
        isDragging: _d,
        isUploading: _u,
        ...props
      }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
        children?: React.ReactNode;
        isDragging?: boolean;
        isUploading?: boolean;
      },
      ref: React.Ref<HTMLTextAreaElement>,
    ) => (
      <div className="relative w-full">
        <textarea ref={ref} {...props}>
          {children}
        </textarea>
      </div>
    ),
  ),
}));

vi.mock("@/hooks/useControlKeyHold", () => ({
  useControlKeyHold: vi.fn(),
}));

vi.mock("zustand/react/shallow", () => ({
  useShallow: (fn: unknown) => fn,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/daily-recap/DailyRecapCard", () => ({
  DailyRecapCard: () => <div data-testid="daily-recap-card" />,
}));

vi.mock("@/components/dashboard/DashboardChat/StreamScrollIndicator", () => ({
  StreamScrollIndicator: ({
    userScrolledUp,
    onLatestClick,
  }: {
    userScrolledUp: boolean;
    onLatestClick: () => void;
  }) => (
    <div data-testid="stream-scroll-indicator">
      {userScrolledUp && <button onClick={onLatestClick}>Latest response…</button>}
    </div>
  ),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      children?: React.ReactNode;
    }) => <div {...props}>{children}</div>,
    span: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLSpanElement> & {
      children?: React.ReactNode;
    }) => <span {...props}>{children}</span>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Lazy import AFTER all mocks are set up
async function renderSidebarChat() {
  const { SidebarChat } = await import(
    "@/app/org/[githubLogin]/_components/SidebarChat"
  );
  return render(<SidebarChat githubLogin="test-org" />);
}

describe("SidebarChat — activity indicator", () => {
  beforeEach(() => {
    vi.resetModules();
    mockIsActive = false;
  });

  it("does not render pulsing dot when isActive is false", async () => {
    mockIsActive = false;
    await renderSidebarChat();
    expect(screen.queryByLabelText("agent active")).toBeNull();
    expect(screen.getByText("Ask Jamie")).toBeDefined();
  });

  it("renders pulsing dot when isActive is true", async () => {
    mockIsActive = true;
    await renderSidebarChat();
    expect(screen.getByLabelText("agent active")).toBeDefined();
    expect(screen.getByText("Ask Jamie")).toBeDefined();
  });
});

// ── Scroll behaviour tests ─────────────────────────────────────────────────────

const SAMPLE_MESSAGE = {
  id: "msg-1",
  role: "assistant" as const,
  content: "Hello from the agent",
  createdAt: new Date().toISOString(),
};

const SECOND_MESSAGE = {
  id: "msg-2",
  role: "assistant" as const,
  content: "Second message",
  createdAt: new Date().toISOString(),
};

function buildStoreState(messages: typeof SAMPLE_MESSAGE[]) {
  return {
    activeConversationId: "conv-1",
    conversations: {
      "conv-1": {
        messages,
        isLoading: false,
        activeToolCalls: [],
        serverConversationId: null,
      },
    },
    artifacts: {},
    dismissedArtifactIds: {},
    pendingInputDraft: null,
  };
}

describe("SidebarChat — scroll behaviour", () => {
  let scrollIntoViewMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    mockIsActive = false;
    mockStoreState = buildStoreState([SAMPLE_MESSAGE]) as typeof mockStoreState;
    // jsdom does not implement scrollIntoView — install a mock on the prototype
    scrollIntoViewMock = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
  });

  afterEach(() => {
    // Reset store to default (no active conversation)
    mockStoreState = {
      activeConversationId: null,
      conversations: {},
      artifacts: {},
      dismissedArtifactIds: {},
      pendingInputDraft: null,
    };
  });

  it("auto-scrolls to bottom when userScrolledUp is false (initial render)", async () => {
    await renderSidebarChat();
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  it("suppresses auto-scroll after user scrolls up", async () => {
    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    const { container, rerender } = render(<SidebarChat githubLogin="test-org" />);

    // Find the scroll container (the overflow-y-auto div)
    const scrollEl = container.querySelector(".overflow-y-auto") as HTMLElement;
    expect(scrollEl).not.toBeNull();

    // Mock scroll position: scrollTop + clientHeight < scrollHeight - 50 (user scrolled up)
    Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollEl, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(scrollEl, "scrollTop", { value: 0, configurable: true, writable: true });

    // The initial auto-scroll effect sets isProgrammaticScrollRef.current = true.
    // The first scroll event consumes that flag (early-return) so it doesn't
    // change userScrolledUp. The second event is the real "user scrolled up".
    act(() => { fireEvent.scroll(scrollEl); }); // consume programmatic flag
    act(() => { fireEvent.scroll(scrollEl); }); // actual user scroll-up

    // Clear call count after scroll-triggered re-render
    scrollIntoViewMock.mockClear();

    // Update mockStoreState with a second message and re-render —
    // since userScrolledUp is now true, scrollIntoView should NOT be called.
    act(() => {
      mockStoreState = buildStoreState([SAMPLE_MESSAGE, SECOND_MESSAGE]) as typeof mockStoreState;
      rerender(<SidebarChat githubLogin="test-org" />);
    });

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("shows 'Latest response…' button when scrolled up; hides it when back at bottom", async () => {
    const { container } = await renderSidebarChat();

    const scrollEl = container.querySelector(".overflow-y-auto") as HTMLElement;

    // Mock scroll position: scrolled to top (far from bottom)
    Object.defineProperty(scrollEl, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scrollEl, "clientHeight", { value: 300, configurable: true });
    Object.defineProperty(scrollEl, "scrollTop", { value: 0, configurable: true, writable: true });

    // First event consumes the programmatic flag; second is the real user scroll-up
    act(() => { fireEvent.scroll(scrollEl); });
    act(() => { fireEvent.scroll(scrollEl); });

    // "Latest response…" button should appear
    expect(screen.getByText("Latest response…")).toBeDefined();

    // Now simulate scrolling back to the bottom (scrollTop 700 + clientHeight 300 >= scrollHeight 1000 - 50)
    Object.defineProperty(scrollEl, "scrollTop", { value: 700, configurable: true, writable: true });

    act(() => {
      fireEvent.scroll(scrollEl);
    });

    // Button should be gone
    expect(screen.queryByText("Latest response…")).toBeNull();
  });

  it("StreamScrollIndicator is a sibling of the scroll container, not a descendant", async () => {
    const { container } = await renderSidebarChat();

    const scrollEl = container.querySelector(".overflow-y-auto");
    expect(scrollEl).not.toBeNull();

    // The indicator must NOT be inside the overflow scroll div
    const indicatorInsideScroll = scrollEl!.querySelector("[data-testid='stream-scroll-indicator']");
    expect(indicatorInsideScroll).toBeNull();

    // It should still exist as a sibling in the component tree
    const indicator = container.querySelector("[data-testid='stream-scroll-indicator']");
    expect(indicator).not.toBeNull();
  });
});

// ── handleClear / New chat — URL param stripping tests ────────────────────────

describe("SidebarChat — handleClear strips ?chat= param", () => {
  let startConversationMock: ReturnType<typeof vi.fn>;
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.resetModules();
    mockIsActive = false;
    startConversationMock = vi.fn().mockReturnValue("new-conv-id");

    // Give the store a live conversation with messages so the "New chat"
    // button is enabled (it is disabled when !hasMessages).
    mockStoreState = {
      activeConversationId: "old-conv",
      conversations: {
        "old-conv": {
          messages: [{ id: "m1", role: "user", content: "hi", createdAt: new Date().toISOString() }],
          isLoading: false,
          activeToolCalls: [],
          serverConversationId: null,
          context: { orgId: "o1", githubLogin: "test-org" },
        },
      },
      artifacts: {},
      dismissedArtifactIds: {},
      pendingInputDraft: null,
    } as typeof mockStoreState;

    // Patch getState on the mock so handleClear can call useCanvasChatStore.getState()
    const { useCanvasChatStore } = await import(
      "@/app/org/[githubLogin]/_state/canvasChatStore"
    );
    (useCanvasChatStore as unknown as { getState: () => unknown }).getState = () => ({
      activeConversationId: "old-conv",
      conversations: {
        "old-conv": { context: { orgId: "o1", githubLogin: "test-org" } },
      },
      startConversation: startConversationMock,
    });

    replaceStateSpy = vi.spyOn(window.history, "replaceState");
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
    mockStoreState = {
      activeConversationId: null,
      conversations: {},
      artifacts: {},
      dismissedArtifactIds: {},
      pendingInputDraft: null,
    };
  });

  it("calls startConversation then replaceState to remove ?chat= param", async () => {
    // Set URL with a stale ?chat= param
    window.history.replaceState(null, "", "/?chat=abc");
    replaceStateSpy.mockClear();

    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    await act(async () => { fireEvent.click(screen.getByTitle("New chat")); });

    // startConversation was called before replaceState
    expect(startConversationMock).toHaveBeenCalledTimes(1);

    // replaceState was called and the resulting URL has no chat= param
    expect(replaceStateSpy).toHaveBeenCalled();
    const [, , url] = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1] as [unknown, unknown, string];
    expect(url).not.toMatch(/chat=/);
  });

  it("preserves other query params (e.g. ?c=foo) while removing ?chat=", async () => {
    window.history.replaceState(null, "", "/?chat=abc&c=foo");
    replaceStateSpy.mockClear();

    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    await act(async () => { fireEvent.click(screen.getByTitle("New chat")); });

    const [, , url] = replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1] as [unknown, unknown, string];
    expect(url).not.toMatch(/chat=/);
    expect(url).toMatch(/c=foo/);
  });

  it("uses window.history.replaceState (not router.replace) — replaceState is called exactly once per click", async () => {
    // SidebarChat does not import or call Next router — replaceState is the
    // only mechanism used. Verify it is invoked for the chat-param strip.
    window.history.replaceState(null, "", "/?chat=xyz");
    replaceStateSpy.mockClear();

    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    await act(async () => { fireEvent.click(screen.getByTitle("New chat")); });

    // Exactly one replaceState call from handleClear (stripping the chat param)
    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", expect.any(String));
  });
});

describe("SidebarChat — DailyRecapCard placement", () => {
  beforeEach(() => {
    vi.resetModules();
    mockIsActive = false;
    mockStoreState = {
      activeConversationId: null,
      conversations: {},
      artifacts: {},
      dismissedArtifactIds: {},
      pendingInputDraft: null,
    };
  });

  it("renders exactly one DailyRecapCard on initial load with no messages", async () => {
    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    const cards = screen.getAllByTestId("daily-recap-card");
    expect(cards).toHaveLength(1);
  });

  it("renders DailyRecapCard before the empty-state placeholder in DOM order", async () => {
    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    const { container } = render(<SidebarChat githubLogin="test-org" />);

    const card = container.querySelector("[data-testid='daily-recap-card']");
    const placeholder = screen.getByText("Ask the agent about anything on this canvas.");

    expect(card).not.toBeNull();
    // card should come before placeholder in the DOM
    expect(
      card!.compareDocumentPosition(placeholder) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders exactly one DailyRecapCard when messages are present", async () => {
    mockStoreState = {
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": {
          id: "conv-1",
          messages: [
            { id: "m1", role: "user", content: [{ type: "text", text: "hello" }] },
          ],
          activeToolCalls: [],
          isLoading: false,
          streamingArtifacts: {},
        },
      },
      artifacts: {},
      dismissedArtifactIds: {},
      pendingInputDraft: null,
    };

    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    const cards = screen.getAllByTestId("daily-recap-card");
    expect(cards).toHaveLength(1);
  });
});

// ── Fork chat — toolbar button disabled states & happy path ───────────────────

describe("SidebarChat — Fork chat button", () => {
  let startConversationMock: ReturnType<typeof vi.fn>;
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  // A minimal conversation state with a persisted serverConversationId so
  // the fork button is enabled by default in most tests.
  const withServerConversation = (extras?: Partial<Record<string, unknown>>) =>
    ({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": {
          messages: [
            { id: "m1", role: "user", content: "hello", timestamp: new Date() },
            { id: "m2", role: "assistant", content: "hi", timestamp: new Date() },
          ],
          isLoading: false,
          isStreaming: false,
          activeToolCalls: [],
          serverConversationId: "srv-1",
          context: { orgId: "o1", githubLogin: "test-org" },
          ...extras,
        },
      },
      artifacts: {},
      dismissedArtifactIds: {},
      pendingInputDraft: null,
    }) as typeof mockStoreState;

  beforeEach(async () => {
    vi.resetModules();
    mockIsActive = false;

    startConversationMock = vi.fn().mockReturnValue("new-fork-conv-id");

    // Patch getState so handleFork can read the active conversation context
    const { useCanvasChatStore } = await import(
      "@/app/org/[githubLogin]/_state/canvasChatStore"
    );
    (useCanvasChatStore as unknown as { getState: () => unknown }).getState = () => ({
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": {
          context: { orgId: "o1", githubLogin: "test-org" },
          serverConversationId: "srv-1",
        },
      },
      startConversation: startConversationMock,
    });

    // Stub global fetch — GET returns source messages, POST returns fork id
    fetchMock = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (!opts || opts.method !== "POST") {
        // GET source conversation
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [
                { id: "m1", role: "user", content: "hello" },
                { id: "m2", role: "assistant", content: "hi" },
              ],
              settings: {},
            }),
        });
      }
      // POST create fork
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: "fork-srv-1", title: "Fork", lastMessageAt: null }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    replaceStateSpy = vi.spyOn(window.history, "replaceState");
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
    vi.unstubAllGlobals();
    mockStoreState = {
      activeConversationId: null,
      conversations: {},
      artifacts: {},
      dismissedArtifactIds: {},
      pendingInputDraft: null,
    };
  });

  it("renders the Fork chat button in the toolbar", async () => {
    mockStoreState = withServerConversation();
    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);
    expect(screen.getByTitle("Fork chat")).toBeTruthy();
  });

  it("is disabled when there is no serverConversationId (empty conversation)", async () => {
    mockStoreState = {
      activeConversationId: "conv-1",
      conversations: {
        "conv-1": {
          messages: [],
          isLoading: false,
          isStreaming: false,
          activeToolCalls: [],
          serverConversationId: null,
          context: { orgId: "o1", githubLogin: "test-org" },
        },
      },
      artifacts: {},
      dismissedArtifactIds: {},
      pendingInputDraft: null,
    } as typeof mockStoreState;

    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    const forkBtn = screen.getByTitle("Fork chat");
    expect((forkBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("is disabled while the conversation is streaming", async () => {
    mockStoreState = withServerConversation({ isStreaming: true });

    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    const forkBtn = screen.getByTitle("Fork chat");
    expect((forkBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("is enabled when serverConversationId exists and not streaming", async () => {
    mockStoreState = withServerConversation();
    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    const forkBtn = screen.getByTitle("Fork chat");
    expect((forkBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("click: issues GET then POST, seeds store with forkedFromShareId + ephemeralSeedCount, replaceStates ?chat= to fork id", async () => {
    mockStoreState = withServerConversation();
    window.history.replaceState(null, "", "/?canvas=root");
    replaceStateSpy.mockClear();

    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Fork chat"));
    });

    // 1. GET was called first
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/orgs/test-org/chat/conversations/srv-1",
    );

    // 2. POST was called second (create fork)
    const postCall = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    expect(postCall![0]).toBe("/api/orgs/test-org/chat/conversations");

    // 3. store.startConversation was called with forkedFromShareId = "srv-1",
    //    ephemeralSeedCount = 2 (two messages), serverConversationId = "fork-srv-1"
    expect(startConversationMock).toHaveBeenCalledTimes(1);
    const [, hydrated, forkedFromShareId, ephemeralSeedCount, serverConvId] =
      startConversationMock.mock.calls[0];
    expect(forkedFromShareId).toBe("srv-1");
    expect(ephemeralSeedCount).toBe(2);
    expect(serverConvId).toBe("fork-srv-1");
    expect(Array.isArray(hydrated)).toBe(true);
    expect(hydrated).toHaveLength(2);

    // 4. replaceState was called with the fork id in ?chat=
    expect(replaceStateSpy).toHaveBeenCalled();
    const [, , url] =
      replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1] as [
        unknown,
        unknown,
        string,
      ];
    expect(url).toMatch(/chat=fork-srv-1/);
  });

  it("preserves other query params (e.g. ?canvas=) while setting ?chat= to fork id", async () => {
    mockStoreState = withServerConversation();
    window.history.replaceState(null, "", "/?canvas=init-abc");
    replaceStateSpy.mockClear();

    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    await act(async () => {
      fireEvent.click(screen.getByTitle("Fork chat"));
    });

    const [, , url] =
      replaceStateSpy.mock.calls[replaceStateSpy.mock.calls.length - 1] as [
        unknown,
        unknown,
        string,
      ];
    expect(url).toMatch(/canvas=init-abc/);
    expect(url).toMatch(/chat=fork-srv-1/);
  });

  it("double-click issues exactly one fork (guarded by isForking)", async () => {
    // Simulate a slow POST so the second click lands while the first is in-flight
    let resolveFork!: (value: Response) => void;
    const slowFetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (!opts || opts.method !== "POST") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              messages: [{ id: "m1", role: "user", content: "hello" }],
              settings: {},
            }),
        });
      }
      return new Promise<Response>((resolve) => {
        resolveFork = () =>
          resolve({
            ok: true,
            json: () =>
              Promise.resolve({ id: "fork-srv-slow", title: "Fork", lastMessageAt: null }),
          } as Response);
      });
    });
    vi.stubGlobal("fetch", slowFetch);

    mockStoreState = withServerConversation();
    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    const forkBtn = screen.getByTitle("Fork chat");

    // First click — fork in-flight
    fireEvent.click(forkBtn);

    // Flush microtasks so the GET resolves and the POST is initiated,
    // which assigns resolveFork and causes React to re-render with
    // isForking=true (disabling the button).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Second click while in-flight — button is disabled (isForking=true),
    // and handleFork's own guard also returns early.
    fireEvent.click(forkBtn);

    // Resolve the slow POST
    await act(async () => {
      resolveFork();
      await new Promise((r) => setTimeout(r, 0));
    });

    // startConversation called exactly once
    expect(startConversationMock).toHaveBeenCalledTimes(1);
  });

  it("shows an error toast when the GET fails", async () => {
    const failFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", failFetch);

    mockStoreState = withServerConversation();
    const { SidebarChat } = await import(
      "@/app/org/[githubLogin]/_components/SidebarChat"
    );
    render(<SidebarChat githubLogin="test-org" />);

    const { toast } = await import("sonner");

    await act(async () => {
      fireEvent.click(screen.getByTitle("Fork chat"));
    });

    expect(startConversationMock).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
