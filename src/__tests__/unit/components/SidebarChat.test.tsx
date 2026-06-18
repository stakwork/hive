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
