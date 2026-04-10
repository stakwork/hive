/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatArea } from "@/app/w/[slug]/task/[...taskParams]/components/ChatArea";

globalThis.React = React;

// ── Heavy dependency mocks ────────────────────────────────────────────────────

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) =>
      React.createElement("div", rest, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null) }),
}));

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/components/plan/InvitePopover", () => ({
  InvitePopover: () => null,
}));

vi.mock("@/components/whiteboard/CollaboratorAvatars", () => ({
  CollaboratorAvatars: () => null,
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ChatInput", () => ({
  ChatInput: () => React.createElement("div", { "data-testid": "chat-input" }),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ChatMessage", () => ({
  ChatMessage: () => React.createElement("div", { "data-testid": "chat-message" }),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/TaskBreadcrumbs", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("@/lib/icons", () => ({
  getAgentIcon: () => null,
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// ── Helpers ──────────────────────────────────────────────────────────────────

const baseProps = {
  messages: [],
  onSend: vi.fn(),
  onArtifactAction: vi.fn(),
  taskTitle: "Test Task",
  workspaceSlug: "test-workspace",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ChatArea — Save button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Save' button when isPrototypeTask=true and onSaveAndPlan is provided (DIFF artifact present)", () => {
    render(
      <ChatArea
        {...baseProps}
        isPrototypeTask={true}
        onSaveAndPlan={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("calls onSaveAndPlan when the button is clicked", async () => {
    const user = userEvent.setup();
    const onSaveAndPlan = vi.fn();

    render(
      <ChatArea
        {...baseProps}
        isPrototypeTask={true}
        onSaveAndPlan={onSaveAndPlan}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSaveAndPlan).toHaveBeenCalledOnce();
  });

  it("does NOT render 'Save' button when isPrototypeTask=false", () => {
    render(
      <ChatArea
        {...baseProps}
        isPrototypeTask={false}
        onSaveAndPlan={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  it("does NOT render 'Save' button when onSaveAndPlan is not provided (no DIFF artifact)", () => {
    render(
      <ChatArea
        {...baseProps}
        isPrototypeTask={true}
      />,
    );

    expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
  });

  it("shows 'Saving…' and disables button when isSavingPlan=true", () => {
    render(
      <ChatArea
        {...baseProps}
        isPrototypeTask={true}
        isSavingPlan={true}
        onSaveAndPlan={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /saving/i });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
  });
});
