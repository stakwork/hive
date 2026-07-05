/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

globalThis.React = React;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "test-workspace" }),
}));

vi.mock("@/hooks/useWorkflowPolling", () => ({
  useWorkflowPolling: () => ({
    workflowData: null,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/lib/utils/workflow-diff", () => ({
  computeWorkflowDiff: () => ({
    changedStepIds: new Set<string>(),
    changedConnectionIds: new Set<string>(),
  }),
}));

// Heavy visual components — capture last props so tests can inspect them
let lastWorkflowComponentProps: Record<string, unknown> = {};
vi.mock("@/components/workflow", () => ({
  __esModule: true,
  default: ({ props }: { props: Record<string, unknown> }) => {
    lastWorkflowComponentProps = props ?? {};
    return React.createElement("div", { "data-testid": "workflow-component" });
  },
}));

vi.mock("@/components/StepDetailsModal", () => ({
  StepDetailsModal: () => null,
}));

vi.mock("@/components/prompts", () => ({
  PromptsPanel: () => null,
}));

vi.mock("@/components/ProjectInfoCard", () => ({
  ProjectInfoCard: () => null,
}));

vi.mock("@/components/StakworkRunDropdown", () => ({
  StakworkRunDropdown: ({ projectId }: { projectId: string }) =>
    React.createElement("div", { "data-testid": "stakwork-run-dropdown", "data-project-id": projectId }),
}));

// Mock ChangesList — capture items so tests can inspect them
let lastChangesListItems: Array<{ type: string; name: string; [key: string]: unknown }> = [];
vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts/changes/ChangesList", () => ({
  ChangesList: (props: { items: Array<{ type: string; name: string; [key: string]: unknown }> }) => {
    lastChangesListItems = props.items ?? [];
    return React.createElement(
      "div",
      { "data-testid": "changes-list" },
      props.items.map((item, i) =>
        React.createElement("div", {
          key: i,
          "data-testid": `changes-section-${item.type.toLowerCase()}`,
          "data-item-name": item.name,
        }),
      ),
    );
  },
}));

// Also keep WorkflowChangesPanel mock to prevent import errors in case it's still imported
vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts/WorkflowChangesPanel", () => ({
  WorkflowChangesPanel: () => null,
}));

// ---------------------------------------------------------------------------
// Component import (after all vi.mock calls)
// ---------------------------------------------------------------------------

import { WorkflowArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/WorkflowArtifactPanel";
import type { Artifact } from "@/lib/chat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflowJson(transitions: Record<string, unknown>): string {
  return JSON.stringify({ transitions });
}

function makeArtifact(overrides: Partial<Artifact["content"]> = {}): Artifact {
  return {
    id: "art-1",
    type: "workflow",
    content: {
      workflowJson: makeWorkflowJson({}),
      ...overrides,
    } as Artifact["content"],
  } as unknown as Artifact;
}

function makePublishPromptArtifact(overrides: {
  promptId?: string;
  promptVersionId?: string;
  promptName?: string;
  id?: string;
} = {}): Artifact {
  return {
    id: overrides.id ?? "art-prompt-1",
    type: "PUBLISH_PROMPT",
    content: {
      promptId: overrides.promptId ?? "prompt-abc",
      promptVersionId: overrides.promptVersionId ?? "ver-xyz",
      promptName: overrides.promptName ?? "MY_PROMPT",
    },
  } as unknown as Artifact;
}

function makePublishScriptArtifact(overrides: {
  scriptId?: number;
  scriptVersionId?: number;
  scriptName?: string;
  id?: string;
} = {}): Artifact {
  return {
    id: overrides.id ?? "art-script-1",
    type: "PUBLISH_SCRIPT",
    content: {
      scriptId: overrides.scriptId ?? 42,
      scriptVersionId: overrides.scriptVersionId ?? 7,
      scriptName: overrides.scriptName ?? "my_script.py",
    },
  } as unknown as Artifact;
}

const loopTransition = {
  id: "step-loop",
  unique_id: "step-loop",
  display_id: "step-loop",
  display_name: "Loop Step",
  name: "LoopStep",
  title: "Loop Step",
  skill: { type: "loop" },
  position: { x: 0, y: 0 },
  connections: {},
  attributes: { workflow_id: 42, workflow_name: "Child Workflow Alpha" },
};

// Real API format: WorkflowRunner step with top-level attributes, no skill field
const loopTransitionRealApi = {
  id: "run_evaluate_operation",
  unique_id: "c9d8e7f6-a5b4-3c2d-1e0f-fedcba987654",
  name: "WorkflowRunner",
  skill_icon: "loop.svg",
  position: { x: 1519, y: 180 },
  attributes: { workflow_id: 55279, workflow_name: "evaluate_operation_child" },
};

const nonLoopTransition = {
  id: "step-auto",
  unique_id: "step-auto",
  display_id: "step-auto",
  display_name: "Auto Step",
  name: "AutoStep",
  title: "Auto Step",
  skill: { type: "automated" },
  position: { x: 0, y: 0 },
  connections: {},
  step: { attributes: {}, params: {} },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  lastWorkflowComponentProps = {};
});

describe("WorkflowArtifactPanel — Child Workflows tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub window.open
    vi.stubGlobal("open", vi.fn());
  });

  describe("tab visibility", () => {
    it("does NOT show Child Workflows tab when there are no loop steps", () => {
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepA: nonLoopTransition }),
      });
      render(<WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />);
      expect(screen.queryByRole("tab", { name: /child workflows/i })).toBeNull();
    });

    it("does NOT show Child Workflows tab when loop step has no workflow_id", () => {
      const loopNoId = {
        ...loopTransition,
        attributes: { workflow_name: "Child Workflow Alpha" },
      };
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepLoop: loopNoId }),
      });
      render(<WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />);
      expect(screen.queryByRole("tab", { name: /child workflows/i })).toBeNull();
    });

    it("does NOT show Child Workflows tab when loop step has no workflow_name", () => {
      const loopNoName = {
        ...loopTransition,
        attributes: { workflow_id: 42 },
      };
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepLoop: loopNoName }),
      });
      render(<WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />);
      expect(screen.queryByRole("tab", { name: /child workflows/i })).toBeNull();
    });

    it("shows Child Workflows tab for real API format (WorkflowRunner, no skill field)", () => {
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepLoop: loopTransitionRealApi }),
      });
      render(<WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />);
      expect(screen.getByRole("tab", { name: /child workflows/i })).toBeInTheDocument();
    });

    it("shows Child Workflows tab when a loop step has workflow_id", () => {
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepLoop: loopTransition }),
      });
      render(<WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />);
      expect(screen.getByRole("tab", { name: /child workflows/i })).toBeInTheDocument();
    });
  });

  describe("table content", () => {
    it("renders workflow name and ID after switching to the tab", async () => {
      const user = userEvent.setup();
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepLoop: loopTransition }),
      });
      const { container } = render(
        <WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />,
      );

      await user.click(screen.getByRole("tab", { name: /child workflows/i }));

      const childPanel = container.querySelector('[data-slot="tabs-content"][id*="children"]');
      expect(childPanel?.textContent).toContain("Child Workflow Alpha");
      expect(childPanel?.textContent).toContain("42");
    });

    it("renders workflow name and ID for real API format (WorkflowRunner)", async () => {
      const user = userEvent.setup();
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepLoop: loopTransitionRealApi }),
      });
      const { container } = render(
        <WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />,
      );

      await user.click(screen.getByRole("tab", { name: /child workflows/i }));

      const childPanel = container.querySelector('[data-slot="tabs-content"][id*="children"]');
      expect(childPanel?.textContent).toContain("evaluate_operation_child");
      expect(childPanel?.textContent).toContain("55279");
    });

    it("renders multiple child workflow rows", async () => {
      const user = userEvent.setup();
      const secondLoop = {
        ...loopTransition,
        id: "step-loop-2",
        unique_id: "step-loop-2",
        attributes: { workflow_id: 77, workflow_name: "Child Beta" },
      };
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({
          stepLoop1: loopTransition,
          stepLoop2: secondLoop,
        }),
      });
      const { container } = render(
        <WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />,
      );

      await user.click(screen.getByRole("tab", { name: /child workflows/i }));

      const childPanel = container.querySelector('[data-slot="tabs-content"][id*="children"]');
      expect(childPanel?.textContent).toContain("Child Workflow Alpha");
      expect(childPanel?.textContent).toContain("Child Beta");
    });
  });

  describe("open button", () => {
    it("calls window.open with the correct URL when the open button is clicked", async () => {
      const user = userEvent.setup();
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepLoop: loopTransition }),
      });
      render(<WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />);

      await user.click(screen.getByRole("tab", { name: /child workflows/i }));

      // Icon-only button inside the active children panel
      const openBtn = screen.getByRole("button", { name: /open/i });
      await user.click(openBtn);

      expect(window.open).toHaveBeenCalledWith(
        "https://hive.sphinx.chat/w/stakwork/workflows?id=42",
        "_blank",
      );
    });

    it("calls window.open with correct URL for real API format (WorkflowRunner)", async () => {
      const user = userEvent.setup();
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepLoop: loopTransitionRealApi }),
      });
      render(<WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />);

      await user.click(screen.getByRole("tab", { name: /child workflows/i }));

      const openBtn = screen.getByRole("button", { name: /open/i });
      await user.click(openBtn);

      expect(window.open).toHaveBeenCalledWith(
        "https://hive.sphinx.chat/w/stakwork/workflows?id=55279",
        "_blank",
      );
    });
  });

  describe("grid-cols calculation", () => {
    it("renders no tablist when no workflowJson (non-editor mode)", () => {
      // No workflowJson → isEditorMode=false → non-editor code path, no tabs rendered
      const artifact = makeArtifact({ workflowJson: undefined });
      const { container } = render(
        <WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />,
      );
      const tabsList = container.querySelector('[role="tablist"]');
      expect(tabsList).toBeNull();
    });

    it("uses grid-cols-4 when in editor mode (Changes tab visible) but no Children", () => {
      // workflowJson present → showChangesTab=true; no loop steps → no Children
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepA: nonLoopTransition }),
      });
      const { container } = render(
        <WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />,
      );
      const tabsList = container.querySelector('[role="tablist"]');
      expect(tabsList?.className).toContain("grid-cols-4");
    });

    it("uses grid-cols-4 when in editor mode with originalWorkflowJson but no Children", () => {
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepA: nonLoopTransition }),
        originalWorkflowJson: makeWorkflowJson({ stepA: nonLoopTransition }),
      });
      const { container } = render(
        <WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />,
      );
      const tabsList = container.querySelector('[role="tablist"]');
      expect(tabsList?.className).toContain("grid-cols-4");
    });

    it("uses grid-cols-5 when in editor mode with Children tab visible", () => {
      // workflowJson with loop → showChangesTab=true + hasChildWorkflows=true
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepLoop: loopTransition }),
      });
      const { container } = render(
        <WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />,
      );
      const tabsList = container.querySelector('[role="tablist"]');
      expect(tabsList?.className).toContain("grid-cols-5");
    });

    it("uses grid-cols-5 when both Changes and Children tabs are visible", () => {
      const artifact = makeArtifact({
        workflowJson: makeWorkflowJson({ stepLoop: loopTransition }),
        originalWorkflowJson: makeWorkflowJson({ stepLoop: loopTransition }),
      });
      const { container } = render(
        <WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />,
      );
      const tabsList = container.querySelector('[role="tablist"]');
      expect(tabsList?.className).toContain("grid-cols-5");
    });
  });
});

describe("WorkflowArtifactPanel — StakworkRunDropdown isSuperAdmin gating", () => {
  const artifactWithProject = makeArtifact({
    workflowJson: makeWorkflowJson({ stepA: nonLoopTransition }),
    projectId: "test-project-123",
  });

  it("does NOT render StakworkRunDropdown when isSuperAdmin=false (default)", () => {
    render(<WorkflowArtifactPanel artifacts={[artifactWithProject]} isActive={true} />);
    expect(screen.queryByTestId("stakwork-run-dropdown")).not.toBeInTheDocument();
  });

  it("does NOT render StakworkRunDropdown when isSuperAdmin=false explicitly", () => {
    render(
      <WorkflowArtifactPanel artifacts={[artifactWithProject]} isActive={true} isSuperAdmin={false} />,
    );
    expect(screen.queryByTestId("stakwork-run-dropdown")).not.toBeInTheDocument();
  });

  it("DOES render StakworkRunDropdown when isSuperAdmin=true and projectId is present", () => {
    render(
      <WorkflowArtifactPanel artifacts={[artifactWithProject]} isActive={true} isSuperAdmin={true} />,
    );
    expect(screen.getByTestId("stakwork-run-dropdown")).toBeInTheDocument();
  });

  it("does NOT render StakworkRunDropdown when isSuperAdmin=true but projectId is absent", () => {
    const artifactNoProject = makeArtifact({
      workflowJson: makeWorkflowJson({ stepA: nonLoopTransition }),
    });
    render(
      <WorkflowArtifactPanel artifacts={[artifactNoProject]} isActive={true} isSuperAdmin={true} />,
    );
    expect(screen.queryByTestId("stakwork-run-dropdown")).not.toBeInTheDocument();
  });
});

describe("WorkflowArtifactPanel — workflowVersion prop", () => {
  it("passes workflowVersion=\"174726\" when artifact has workflowVersionId: 174726", () => {
    const artifact = makeArtifact({
      workflowJson: makeWorkflowJson({ stepA: nonLoopTransition }),
      workflowVersionId: 174726 as unknown as string,
    });
    render(<WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />);
    expect(lastWorkflowComponentProps.workflowVersion).toBe("174726");
  });

  it("passes workflowVersion from the last artifact when multiple artifacts have different workflowVersionId values", () => {
    const first = makeArtifact({
      workflowJson: makeWorkflowJson({ stepA: nonLoopTransition }),
      workflowVersionId: "111",
    });
    const second = {
      ...makeArtifact({
        workflowJson: makeWorkflowJson({ stepA: nonLoopTransition }),
        workflowVersionId: "222",
      }),
      id: "art-2",
    };
    render(<WorkflowArtifactPanel artifacts={[first, second]} isActive={false} />);
    expect(lastWorkflowComponentProps.workflowVersion).toBe("222");
  });

  it("passes workflowVersion=\"\" when no artifact has workflowVersionId", () => {
    const artifact = makeArtifact({
      workflowJson: makeWorkflowJson({ stepA: nonLoopTransition }),
    });
    render(<WorkflowArtifactPanel artifacts={[artifact]} isActive={false} />);
    expect(lastWorkflowComponentProps.workflowVersion).toBe("");
  });
});

describe("WorkflowArtifactPanel — Changes tab diff isolation", () => {
  // A realistic baseline string longer than 100 chars
  const baseline = JSON.stringify({ transitions: { stepA: nonLoopTransition, stepB: nonLoopTransition } });
  const updated = JSON.stringify({ transitions: { stepA: nonLoopTransition, stepC: loopTransition } });
  const freshWorkflow = JSON.stringify({ transitions: { stepX: loopTransition } });

  beforeEach(() => {
    lastChangesListItems = [];
  });

  it("Test 1 — subsequent-run: keeps agent-response updatedJson after a second run-start artifact", async () => {
    const user = userEvent.setup();

    const runStartA: Artifact = {
      id: "art-run-start-A",
      type: "workflow",
      content: {
        workflowJson: baseline,
        originalWorkflowJson: "",
        workflowId: 1,
      } as unknown as Artifact["content"],
    } as unknown as Artifact;

    const agentResponseB: Artifact = {
      id: "art-agent-response-B",
      type: "workflow",
      content: {
        workflowJson: updated,
        originalWorkflowJson: baseline, // long string > 100 chars
        workflowId: 1,
      } as unknown as Artifact["content"],
    } as unknown as Artifact;

    const runStartC: Artifact = {
      id: "art-run-start-C",
      type: "workflow",
      content: {
        workflowJson: baseline,
        originalWorkflowJson: "",
        workflowId: 1,
      } as unknown as Artifact["content"],
    } as unknown as Artifact;

    render(
      <WorkflowArtifactPanel
        artifacts={[runStartA, agentResponseB, runStartC]}
        isActive={false}
      />,
    );

    // Switch to Changes tab so ChangesList is rendered
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    // changesWorkflowJson must still be "updated", not "baseline"
    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    expect(workflowItem?.updatedJson).toBe(updated);
  });

  it("Test 2 — publish: keeps agent-response updatedJson after a publish artifact overwrites workflowJson", async () => {
    const user = userEvent.setup();

    const agentResponseA: Artifact = {
      id: "art-agent-response-A",
      type: "workflow",
      content: {
        workflowJson: updated,
        originalWorkflowJson: baseline, // long string > 100 chars
        workflowId: 1,
      } as unknown as Artifact["content"],
    } as unknown as Artifact;

    const publishArtifactB: Artifact = {
      id: "art-publish-B",
      type: "workflow",
      content: {
        workflowJson: freshWorkflow,
        // no originalWorkflowJson
        workflowId: 1,
      } as unknown as Artifact["content"],
    } as unknown as Artifact;

    render(
      <WorkflowArtifactPanel
        artifacts={[agentResponseA, publishArtifactB]}
        isActive={false}
      />,
    );

    // Switch to Changes tab so ChangesList is rendered
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    // changesWorkflowJson must remain "updated", not "freshWorkflow"
    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    expect(workflowItem?.updatedJson).toBe(updated);
  });

  it("Test 3 — first-run baseline fallback: shows workflowJson as all-green when no agent response yet", async () => {
    const user = userEvent.setup();

    const runStartA: Artifact = {
      id: "art-run-start-A",
      type: "workflow",
      content: {
        workflowJson: baseline,
        originalWorkflowJson: "",
        workflowId: 1,
      } as unknown as Artifact["content"],
    } as unknown as Artifact;

    render(
      <WorkflowArtifactPanel artifacts={[runStartA]} isActive={false} />,
    );

    // Switch to Changes tab so ChangesList is rendered
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    // No agent response yet → changesWorkflowJson is undefined → fallback to workflowJson
    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    expect(workflowItem?.updatedJson).toBe(baseline);
  });
});

// ---------------------------------------------------------------------------
// New tests: ChangesList integration, prompt/script-only tasks
// ---------------------------------------------------------------------------

describe("WorkflowArtifactPanel — ChangesList items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastChangesListItems = [];
  });

  it("(a) workflow + prompt + script all changed → three sections in ChangesList", async () => {
    const user = userEvent.setup();
    const workflowArt = makeArtifact({
      workflowJson: makeWorkflowJson({ stepA: nonLoopTransition }),
      workflowId: 1,
      workflowName: "my-workflow",
    });
    const promptArt = makePublishPromptArtifact({ id: "art-p" });
    const scriptArt = makePublishScriptArtifact({ id: "art-s" });

    render(
      <WorkflowArtifactPanel
        artifacts={[workflowArt, promptArt, scriptArt]}
        isActive={false}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /changes/i }));

    expect(lastChangesListItems).toHaveLength(3);
    expect(lastChangesListItems.some((i) => i.type === "WORKFLOW")).toBe(true);
    expect(lastChangesListItems.some((i) => i.type === "PROMPT")).toBe(true);
    expect(lastChangesListItems.some((i) => i.type === "SCRIPT")).toBe(true);
  });

  it("(b) prompt-only task (no workflowJson) → Changes tab appears with PROMPT section", () => {
    const promptArt = makePublishPromptArtifact();

    render(
      <WorkflowArtifactPanel artifacts={[promptArt]} isActive={false} />,
    );

    // Changes tab should be visible even without workflowJson
    expect(screen.getByRole("tab", { name: /changes/i })).toBeInTheDocument();

    // ChangesList should be rendered with a PROMPT item
    expect(screen.getByTestId("changes-list")).toBeInTheDocument();
    expect(lastChangesListItems).toHaveLength(1);
    expect(lastChangesListItems[0].type).toBe("PROMPT");
    expect(lastChangesListItems[0].name).toBe("MY_PROMPT");
  });

  it("(c) script-only task → Changes tab appears with SCRIPT section", () => {
    const scriptArt = makePublishScriptArtifact();

    render(
      <WorkflowArtifactPanel artifacts={[scriptArt]} isActive={false} />,
    );

    expect(screen.getByRole("tab", { name: /changes/i })).toBeInTheDocument();
    expect(lastChangesListItems).toHaveLength(1);
    expect(lastChangesListItems[0].type).toBe("SCRIPT");
    expect(lastChangesListItems[0].name).toBe("my_script.py");
  });

  it("(d) prompt-only task → no Editor/Prompts/Stak Run tabs (editor tabs gated)", () => {
    const promptArt = makePublishPromptArtifact();

    render(
      <WorkflowArtifactPanel artifacts={[promptArt]} isActive={false} />,
    );

    // Editor-specific tabs should NOT appear for prompt-only tasks
    expect(screen.queryByRole("tab", { name: /edit steps/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /prompts/i })).toBeNull();
    expect(screen.queryByRole("tab", { name: /stak run/i })).toBeNull();
  });

  it("(e) prompt item carries correct promptId and promptVersionId to ChangesList", () => {
    const promptArt = makePublishPromptArtifact({
      promptId: "prompt-123",
      promptVersionId: "ver-456",
      promptName: "COOL_PROMPT",
    });

    render(
      <WorkflowArtifactPanel artifacts={[promptArt]} isActive={false} />,
    );

    const promptItem = lastChangesListItems.find((i) => i.type === "PROMPT");
    expect(promptItem?.promptId).toBe("prompt-123");
    expect(promptItem?.promptVersionId).toBe("ver-456");
    expect(promptItem?.name).toBe("COOL_PROMPT");
  });

  it("(f) script item carries correct scriptId and scriptVersionId to ChangesList", () => {
    const scriptArt = makePublishScriptArtifact({
      scriptId: 99,
      scriptVersionId: 5,
      scriptName: "runner.sh",
    });

    render(
      <WorkflowArtifactPanel artifacts={[scriptArt]} isActive={false} />,
    );

    const scriptItem = lastChangesListItems.find((i) => i.type === "SCRIPT");
    expect(scriptItem?.scriptId).toBe(99);
    expect(scriptItem?.scriptVersionId).toBe(5);
    expect(scriptItem?.name).toBe("runner.sh");
  });

  it("no workflow available when no relevant artifacts", () => {
    render(
      <WorkflowArtifactPanel artifacts={[]} isActive={false} />,
    );
    expect(screen.getByText(/no workflow available/i)).toBeInTheDocument();
  });
});
