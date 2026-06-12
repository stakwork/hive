// @vitest-environment jsdom
/**
 * Unit tests for the SidebarChat component header activity indicator.
 *
 * Focuses on:
 * 1. Renders pulsing amber dot when useCanvasAgentActivity returns isActive: true
 * 2. Does not render the dot when isActive: false
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
vi.mock("@/app/org/[githubLogin]/_state/canvasChatStore", () => ({
  useCanvasChatStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({
      activeConversationId: null,
      conversations: {},
      artifacts: {},
      dismissedArtifactIds: {},
      pendingInputDraft: null,
    }),
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

vi.mock("@/hooks/useControlKeyHold", () => ({
  useControlKeyHold: vi.fn(),
}));

vi.mock("zustand/react/shallow", () => ({
  useShallow: (fn: unknown) => fn,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
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
