/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArtifactsPanel } from "@/app/w/[slug]/task/[...taskParams]/components/ArtifactsPanel";
import { ArtifactType } from "@/lib/chat";

globalThis.React = React;

// ── Heavy dependency mocks ────────────────────────────────────────────────────

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) =>
      React.createElement("div", rest, children),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock("@/hooks/useAutoSave", () => ({
  useAutoSave: () => ({ saving: false, saved: false, savedField: null, triggerSaved: vi.fn() }),
}));

vi.mock("@/hooks/useStakworkGeneration", () => ({
  useStakworkGeneration: () => ({ latestRun: null, refetch: vi.fn() }),
}));

vi.mock("@/app/w/[slug]/plan/[featureId]/components/PlanArtifact", () => ({
  PlanArtifactPanel: () => React.createElement("div", { "data-testid": "plan-artifact-panel" }),
}));

vi.mock("@/components/features/CompactTasksList", () => ({
  CompactTasksList: () => React.createElement("div", { "data-testid": "compact-tasks-list" }),
}));

vi.mock("@/app/w/[slug]/plan/[featureId]/components/VerifyPanel", () => ({
  VerifyPanel: () => React.createElement("div", { "data-testid": "verify-panel" }),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/components/ArtifactsHeader", () => ({
  ArtifactsHeader: ({
    headerAction,
  }: {
    availableArtifacts: string[];
    activeArtifact: string | null;
    onArtifactChange: (tab: string) => void;
    headerAction?: React.ReactNode;
  }) =>
    React.createElement("div", { "data-testid": "artifacts-header" }, headerAction ?? null),
}));

vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts", () => ({
  CodeArtifactPanel: () => React.createElement("div", { "data-testid": "code-panel" }),
  BrowserArtifactPanel: () => React.createElement("div", { "data-testid": "browser-panel" }),
  GraphArtifactPanel: () => React.createElement("div", { "data-testid": "graph-panel" }),
  WorkflowArtifactPanel: () => React.createElement("div", { "data-testid": "workflow-panel" }),
  DiffArtifactPanel: () => React.createElement("div", { "data-testid": "diff-panel" }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDiffArtifact(id = "diff-1") {
  return {
    id,
    type: ArtifactType.DIFF,
    content: { files: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
    chatMessageId: "msg-1",
    icon: null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ArtifactsPanel — Save and Plan button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders 'Save and Plan' button when isPrototypeTask=true and a DIFF artifact is present", () => {
    render(
      <ArtifactsPanel
        artifacts={[makeDiffArtifact()]}
        isPrototypeTask={true}
        onSaveAndPlan={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /save and plan/i })).toBeInTheDocument();
  });

  it("calls onSaveAndPlan when the button is clicked", async () => {
    const user = userEvent.setup();
    const onSaveAndPlan = vi.fn();

    render(
      <ArtifactsPanel
        artifacts={[makeDiffArtifact()]}
        isPrototypeTask={true}
        onSaveAndPlan={onSaveAndPlan}
      />,
    );

    await user.click(screen.getByRole("button", { name: /save and plan/i }));
    expect(onSaveAndPlan).toHaveBeenCalledOnce();
  });

  it("does NOT render 'Save and Plan' when isPrototypeTask=false even with a DIFF artifact", () => {
    render(
      <ArtifactsPanel
        artifacts={[makeDiffArtifact()]}
        isPrototypeTask={false}
        onSaveAndPlan={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /save and plan/i })).not.toBeInTheDocument();
  });

  it("does NOT render 'Save and Plan' when isPrototypeTask=true but no DIFF artifact is present", () => {
    render(
      <ArtifactsPanel
        artifacts={[]}
        isPrototypeTask={true}
        onSaveAndPlan={vi.fn()}
      />,
    );

    // No tabs → component renders null
    expect(screen.queryByRole("button", { name: /save and plan/i })).not.toBeInTheDocument();
  });
});
