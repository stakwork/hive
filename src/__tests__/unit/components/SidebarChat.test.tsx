// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => (
      <div className={className}>{children}</div>
    ),
    span: ({ children, className }: React.HTMLAttributes<HTMLSpanElement>) => (
      <span className={className}>{children}</span>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("zustand/react/shallow", () => ({ useShallow: (fn: unknown) => fn }));
vi.mock("lucide-react", () => ({
  Send: () => <svg data-testid="send-icon" />,
  Share2: () => <svg data-testid="share-icon" />,
  X: () => <svg data-testid="x-icon" />,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock("@/components/dashboard/DashboardChat/ToolCallIndicator", () => ({
  ToolCallIndicator: ({ toolCalls }: { toolCalls: unknown[] }) => (
    <div data-testid="tool-call-indicator">{toolCalls.length} tool calls</div>
  ),
}));

vi.mock("@/app/org/[githubLogin]/_components/SidebarChatMessage", () => ({
  SidebarChatMessage: ({ message }: { message: { content: string } }) => (
    <div data-testid="sidebar-chat-message">{message.content}</div>
  ),
}));

vi.mock("@/app/org/[githubLogin]/_components/ProposalCard", () => ({
  ProposalCard: () => null,
  getProposalsFromMessage: () => [],
}));

vi.mock("@/app/org/[githubLogin]/_components/AttentionList", () => ({
  AttentionList: () => null,
}));

vi.mock("@/app/org/[githubLogin]/_state/useSendCanvasChatMessage", () => ({
  useSendCanvasChatMessage: vi.fn(() => vi.fn()),
}));

// ── Store mock (mutable per-test) ─────────────────────────────────────────────

const makeConversation = (
  overrides: Partial<{ isLoading: boolean; activeToolCalls: unknown[]; messages: unknown[] }> = {},
) => ({
  messages: [],
  isLoading: false,
  activeToolCalls: [],
  ...overrides,
});

let storeState = {
  activeConversationId: "conv-1" as string | null,
  conversations: { "conv-1": makeConversation() } as Record<string, ReturnType<typeof makeConversation>>,
  artifacts: {} as Record<string, unknown>,
  dismissedArtifactIds: {} as Record<string, boolean>,
  pendingInputDraft: null as string | null,
  clearActiveConversation: vi.fn(),
  dismissArtifact: vi.fn(),
  setPendingInputDraft: vi.fn(),
};

vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: vi.fn((selector: (s: typeof storeState) => unknown) =>
    selector(storeState),
  ),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

import { SidebarChat } from "@/app/org/[githubLogin]/_components/SidebarChat";

describe("SidebarChat — ellipsis loading indicator", () => {
  beforeEach(() => {
    storeState = {
      activeConversationId: "conv-1",
      conversations: { "conv-1": makeConversation() },
      artifacts: {},
      dismissedArtifactIds: {},
      pendingInputDraft: null,
      clearActiveConversation: vi.fn(),
      dismissArtifact: vi.fn(),
      setPendingInputDraft: vi.fn(),
    };
  });

  it("renders animated ellipsis when isLoading=true and activeToolCalls=[]", () => {
    storeState.conversations["conv-1"] = makeConversation({ isLoading: true, activeToolCalls: [] });
    render(<SidebarChat githubLogin="test-org" />);

    const dots = screen.getAllByText(".");
    expect(dots).toHaveLength(3);
  });

  it("does not render ellipsis when isLoading=false", () => {
    storeState.conversations["conv-1"] = makeConversation({ isLoading: false, activeToolCalls: [] });
    render(<SidebarChat githubLogin="test-org" />);

    expect(screen.queryAllByText(".")).toHaveLength(0);
  });

  it("does not render ellipsis when isLoading=true but activeToolCalls is non-empty", () => {
    storeState.conversations["conv-1"] = makeConversation({
      isLoading: true,
      activeToolCalls: [{ id: "tc-1", name: "some_tool", status: "running" }],
    });
    render(<SidebarChat githubLogin="test-org" />);

    expect(screen.queryAllByText(".")).toHaveLength(0);
    expect(screen.getByTestId("tool-call-indicator")).toBeInTheDocument();
  });

  it("renders ToolCallIndicator instead of ellipsis when activeToolCalls is populated", () => {
    storeState.conversations["conv-1"] = makeConversation({
      isLoading: true,
      activeToolCalls: [{ id: "tc-1", name: "canvas_tool", status: "running" }],
    });
    render(<SidebarChat githubLogin="test-org" />);

    expect(screen.getByTestId("tool-call-indicator")).toBeInTheDocument();
    expect(screen.queryAllByText(".")).toHaveLength(0);
  });
});
