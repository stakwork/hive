/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "hive" }),
}));

vi.mock("@/hooks/useWorkflowPolling", () => ({
  useWorkflowPolling: () => ({
    polledWorkflowData: null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/components/workflow", () => ({
  __esModule: true,
  default: () => React.createElement("div", { "data-testid": "workflow-component" }),
}));

vi.mock("@/components/StepDetailsModal", () => ({
  StepDetailsModal: () => null,
}));

vi.mock("@/components/prompts", () => ({
  PromptsPanel: () => null,
}));

vi.mock("./WorkflowChangesPanel", () => ({
  WorkflowChangesPanel: () => null,
}));

vi.mock("@/components/ProjectInfoCard", () => ({
  ProjectInfoCard: () => null,
}));

vi.mock("@/lib/utils/workflow-diff", () => ({
  computeWorkflowDiff: () => ({ additions: [], deletions: [], modifications: [] }),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "tabs" }, children),
  TabsList: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
  TabsTrigger: ({ children }: { children: React.ReactNode }) =>
    React.createElement("button", null, children),
  TabsContent: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

// Mock StakworkRunDropdown to capture props
vi.mock("@/components/StakworkRunDropdown", () => ({
  StakworkRunDropdown: (props: { projectId: string; hiveUrl: string; [key: string]: unknown }) =>
    React.createElement("div", {
      "data-testid": "stakwork-run-dropdown",
      "data-project-id": props.projectId,
      "data-hive-url": props.hiveUrl,
    }),
}));

// ── Component under test ──────────────────────────────────────────────────────

import { WorkflowArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/WorkflowArtifactPanel";
import { Artifact } from "@/lib/chat";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWorkflowArtifact(projectId: string): Artifact {
  return {
    id: "art-1",
    type: "workflow",
    content: {
      projectId,
      workflowId: 42,
      workflowJson: JSON.stringify({ nodes: [], edges: [] }),
    } satisfies import("@/lib/chat").WorkflowContent,
  } as unknown as Artifact;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WorkflowArtifactPanel — hiveUrl prop", () => {
  const mockWindowOpen = vi.fn();
  const originalWindowOpen = window.open;

  beforeEach(() => {
    window.open = mockWindowOpen;
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.open = originalWindowOpen;
  });

  it("passes hiveUrl as /w/{slug}/projects?id={projectId} to StakworkRunDropdown", () => {
    const projectId = "99999";
    const artifact = makeWorkflowArtifact(projectId);

    render(
      <WorkflowArtifactPanel
        artifacts={[artifact]}
        isActive={true}
        onStepSelect={undefined}
        isSuperAdmin={true}
      />
    );

    const dropdown = screen.getByTestId("stakwork-run-dropdown");
    expect(dropdown).toBeInTheDocument();
    expect(dropdown).toHaveAttribute("data-hive-url", `/w/hive/projects?id=${projectId}`);
  });

  it("does NOT pass window.location.href as hiveUrl", () => {
    const projectId = "88888";
    const artifact = makeWorkflowArtifact(projectId);

    render(
      <WorkflowArtifactPanel
        artifacts={[artifact]}
        isActive={true}
        onStepSelect={undefined}
        isSuperAdmin={true}
      />
    );

    const dropdown = screen.getByTestId("stakwork-run-dropdown");
    const hiveUrl = dropdown.getAttribute("data-hive-url") ?? "";
    expect(hiveUrl).not.toContain("window.location");
    expect(hiveUrl).not.toBe(typeof window !== "undefined" ? window.location.href : "");
    expect(hiveUrl).toBe(`/w/hive/projects?id=${projectId}`);
  });
});
