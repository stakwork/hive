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
// Use importOriginal to preserve the exported countAddDel pure function.
let lastChangesListItems: Array<{ type: string; name: string; [key: string]: unknown }> = [];
vi.mock("@/app/w/[slug]/task/[...taskParams]/artifacts/changes/ChangesList", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/w/[slug]/task/[...taskParams]/artifacts/changes/ChangesList")>();
  return {
    ...actual,
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
  };
});

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

// ---------------------------------------------------------------------------
// Helper: make an artifact with a durable publish snapshot
// ---------------------------------------------------------------------------

function makeSnapshotArtifact(overrides: {
  id?: string;
  workflowId?: number | string;
  publishedWorkflowJson: string | object;
  /** Pre-publish baseline. null = brand-new. undefined = key absent (fetch-error path). */
  originalWorkflowJson?: string | null;
  workflowJson?: string;
  workflowVersionId?: string | number;
  createdAt?: Date;
}): Artifact {
  const content: Record<string, unknown> = {
    workflowId: overrides.workflowId ?? 1,
    workflowJson: overrides.workflowJson ?? makeWorkflowJson({}),
    publishedWorkflowJson: overrides.publishedWorkflowJson,
    workflowVersionId: overrides.workflowVersionId,
  };
  // Only add originalWorkflowJson to the content object when it is explicitly provided —
  // undefined means "key absent" (simulating a fetch-error artifact), while null means
  // "brand-new workflow" (no prior published version).
  if (overrides.originalWorkflowJson !== undefined) {
    content.originalWorkflowJson = overrides.originalWorkflowJson;
  }
  return {
    id: overrides.id ?? "snap-art-1",
    type: "workflow",
    createdAt: overrides.createdAt ?? new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    content: content as unknown as Artifact["content"],
  } as unknown as Artifact;
}

// ---------------------------------------------------------------------------
// publish-snapshot baseline selection — MIGRATED to single-artifact model
//
// The old cross-artifact two-snapshot derivation (publishSnapshots[len-2]) is retired.
// The panel now reads baseline + current from the LATEST snapshot artifact's own fields:
//   originalWorkflowJson → baseline (null=brand-new, string=real diff, absent=fetch error)
//   publishedWorkflowJson → current (right side)
// ---------------------------------------------------------------------------

describe("WorkflowArtifactPanel — publish-snapshot baseline selection", () => {
  const snap1Json = JSON.stringify({ transitions: { stepA: nonLoopTransition } });
  const snap2Json = JSON.stringify({ transitions: { stepA: nonLoopTransition, stepB: nonLoopTransition } });
  const snap3Json = JSON.stringify({ transitions: { stepA: nonLoopTransition, stepB: nonLoopTransition, stepC: loopTransition } });

  beforeEach(() => {
    vi.clearAllMocks();
    lastChangesListItems = [];
  });

  // ── Republish with a real baseline → real diff (migrated from cross-artifact test) ──
  it("[migrated] republish: latest snapshot with originalWorkflowJson shows real diff", async () => {
    const user = userEvent.setup();

    // Single artifact carrying BOTH sides — the new single-artifact contract.
    // originalWorkflowJson = snap1Json (prior version before this publish)
    // publishedWorkflowJson = snap2Json (the just-published version)
    const republishArtifact = makeSnapshotArtifact({
      id: "snap-republish",
      publishedWorkflowJson: snap2Json,
      originalWorkflowJson: snap1Json,
      workflowJson: snap2Json,
      createdAt: new Date("2024-01-02T00:00:00Z"),
    });

    render(
      <WorkflowArtifactPanel artifacts={[republishArtifact]} isActive={false} />,
    );
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    // Real diff: originalJson = snap1Json, updatedJson = snap2Json
    expect(workflowItem?.updatedJson).toBe(snap2Json);
    expect(workflowItem?.originalJson).toBe(snap1Json);
  });

  // ── When multiple publish snapshots exist, the LATEST one drives the panel ─
  it("uses the latest publish snapshot's own fields when multiple snapshots exist", async () => {
    const user = userEvent.setup();

    // Older snapshot: was a brand-new first publish (originalWorkflowJson: null)
    const olderSnap = makeSnapshotArtifact({
      id: "snap-old",
      publishedWorkflowJson: snap1Json,
      originalWorkflowJson: null, // brand-new at the time
      workflowJson: snap1Json,
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });

    // Newer snapshot: republish with a real baseline
    const newerSnap = makeSnapshotArtifact({
      id: "snap-new",
      publishedWorkflowJson: snap3Json,
      originalWorkflowJson: snap2Json, // the republish baseline
      workflowJson: snap3Json,
      createdAt: new Date("2024-01-03T00:00:00Z"),
    });

    render(
      <WorkflowArtifactPanel artifacts={[olderSnap, newerSnap]} isActive={false} />,
    );
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    // Latest snapshot drives the panel: updatedJson=snap3Json, originalJson=snap2Json
    expect(workflowItem?.updatedJson).toBe(snap3Json);
    expect(workflowItem?.originalJson).toBe(snap2Json);
  });

  // ── Ordering by createdAt picks the correct latest snapshot ────────────────
  it("uses createdAt order, not array insertion order, to pick the latest snapshot", async () => {
    const user = userEvent.setup();

    // Deliberately insert the newer artifact first in the array
    const newer = makeSnapshotArtifact({
      id: "snap-newer",
      publishedWorkflowJson: snap2Json,
      originalWorkflowJson: snap1Json,
      createdAt: new Date("2024-02-01T00:00:00Z"),
    });
    const older = makeSnapshotArtifact({
      id: "snap-older",
      publishedWorkflowJson: snap1Json,
      originalWorkflowJson: null, // brand-new at the time
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });

    // Array order: [newer, older] — opposite of createdAt order
    render(
      <WorkflowArtifactPanel artifacts={[newer, older]} isActive={false} />,
    );
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    // createdAt sorting: newer (Feb) > older (Jan) → "newer" is the latest snapshot
    expect(workflowItem?.updatedJson).toBe(snap2Json);
    expect(workflowItem?.originalJson).toBe(snap1Json);
  });

  // ── Brand-new first publish (originalWorkflowJson === null) → all-green ───
  it("[migrated] brand-new first publish (originalWorkflowJson === null) → all-green item", async () => {
    const user = userEvent.setup();

    const brandNewArtifact = makeSnapshotArtifact({
      id: "snap-brandnew",
      publishedWorkflowJson: snap1Json,
      originalWorkflowJson: null, // explicitly null = no prior published version
      workflowJson: snap1Json,
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });

    render(
      <WorkflowArtifactPanel artifacts={[brandNewArtifact]} isActive={false} />,
    );
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    // originalWorkflowJson === null → all-green path
    expect(workflowItem?.originalJson).toBeNull();
    expect(workflowItem?.updatedJson).toBe(snap1Json);
  });

  // ── Fresh/un-edited load: workflowJson present, no publishedWorkflowJson → no WORKFLOW item ─
  it("[new] fresh/un-edited task: workflowJson present but no publishedWorkflowJson → Changes shows 'No changes'", async () => {
    const user = userEvent.setup();

    // Artifact with workflowJson but NO publishedWorkflowJson (seed / un-edited task)
    const seedArtifact = makeArtifact({
      workflowJson: snap1Json,
      workflowId: 1 as unknown as string,
      workflowName: "My Workflow",
    });

    render(
      <WorkflowArtifactPanel artifacts={[seedArtifact]} isActive={false} />,
    );
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    // No WORKFLOW item must be pushed — ChangesList has no workflow section
    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    expect(workflowItem).toBeUndefined();
  });

  // ── workflowJson present + no snapshot → no WORKFLOW item (proves removed fallback) ─
  it("[new] workflowJson-only artifact (no publishedWorkflowJson) does NOT produce all-green WORKFLOW item", async () => {
    const user = userEvent.setup();

    // This was the "phantom all-green" bug: workflowJson alone triggered all-green via
    // `!originalWorkflowJson ? workflowJson : null`. That fallback is now removed.
    const plainWorkflowArtifact = makeArtifact({
      workflowJson: snap2Json,
      workflowId: 42 as unknown as string,
    });

    render(
      <WorkflowArtifactPanel artifacts={[plainWorkflowArtifact]} isActive={false} />,
    );
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    expect(workflowItem).toBeUndefined();
  });

  // ── Fetch-error path: originalWorkflowJson key absent → no WORKFLOW item ──
  it("[new] fetch-error artifact (publishedWorkflowJson present, originalWorkflowJson key absent) → no WORKFLOW item", async () => {
    const user = userEvent.setup();

    // originalWorkflowJson is NOT in overrides → key is absent from content
    // This simulates an artifact stored during a baseline-fetch error.
    const fetchErrorArtifact = makeSnapshotArtifact({
      id: "snap-fetch-error",
      publishedWorkflowJson: snap1Json,
      // originalWorkflowJson: intentionally omitted
      workflowJson: snap1Json,
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });

    render(
      <WorkflowArtifactPanel artifacts={[fetchErrorArtifact]} isActive={false} />,
    );
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    // originalWorkflowJson key absent → treated as undefined → no WORKFLOW item
    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    expect(workflowItem).toBeUndefined();
  });

  // ── Different workflowId excluded from active workflow's diff ─────────────
  it("excludes snapshots from a different workflowId from the active workflow's diff", async () => {
    const user = userEvent.setup();

    const activeSnap = makeSnapshotArtifact({
      id: "snap-active",
      workflowId: 100,
      publishedWorkflowJson: snap2Json,
      originalWorkflowJson: null, // brand-new for workflowId 100
      workflowJson: snap2Json,
      createdAt: new Date("2024-01-02T00:00:00Z"),
    });
    // Snapshot belongs to a different workflow — should not bleed into workflow 100's diff
    const otherSnap = makeSnapshotArtifact({
      id: "snap-other",
      workflowId: 999,
      publishedWorkflowJson: snap1Json,
      originalWorkflowJson: null,
      workflowJson: snap2Json,
      createdAt: new Date("2024-01-01T00:00:00Z"),
    });

    render(
      // Both artifacts present; otherSnap has a different workflowId → different group
      <WorkflowArtifactPanel artifacts={[activeSnap, otherSnap]} isActive={false} />,
    );
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    // activeSnap is the only snapshot for workflowId 100 → originalJson: null (all-green)
    // The otherSnap (workflowId: 999) must NOT contribute as a baseline
    expect(workflowItem?.originalJson).toBeNull();
    expect(workflowItem?.updatedJson).toBe(snap2Json);
  });

  // ── Legacy artifact (originalWorkflowJson:"", no publishedWorkflowJson) excluded ─
  it("excludes legacy WORKFLOW artifacts with originalWorkflowJson:\"\" from snapshot gathering", async () => {
    const user = userEvent.setup();

    const legacyArtifact: Artifact = {
      id: "legacy-art",
      type: "workflow",
      createdAt: new Date("2024-01-01T00:00:00Z"),
      updatedAt: new Date("2024-01-01T00:00:00Z"),
      content: {
        workflowId: 1,
        workflowJson: snap1Json,
        originalWorkflowJson: "", // legacy field set by workflow-editor.ts / route.ts
        // no publishedWorkflowJson
      } as unknown as Artifact["content"],
    } as unknown as Artifact;

    const realSnapshot = makeSnapshotArtifact({
      id: "snap-real",
      workflowId: 1,
      publishedWorkflowJson: snap2Json,
      originalWorkflowJson: null, // brand-new
      workflowJson: snap2Json,
      createdAt: new Date("2024-01-02T00:00:00Z"),
    });

    render(
      <WorkflowArtifactPanel artifacts={[legacyArtifact, realSnapshot]} isActive={false} />,
    );
    await user.click(screen.getByRole("tab", { name: /changes/i }));

    const workflowItem = lastChangesListItems.find((i) => i.type === "WORKFLOW");
    // Only realSnapshot qualifies (has publishedWorkflowJson).
    // legacyArtifact must NOT be counted as a snapshot.
    // realSnapshot.originalWorkflowJson === null → all-green
    expect(workflowItem?.originalJson).toBeNull();
    expect(workflowItem?.updatedJson).toBe(snap2Json);
  });

  // ── changedStepIds / changedConnectionIds reach WorkflowComponent ──────────
  it("passes changedStepIds / changedConnectionIds to WorkflowComponent when snapshot has real baseline", async () => {
    // Artifact with a real string baseline → hasChanges=true → computeWorkflowDiff called
    const republishArtifact = makeSnapshotArtifact({
      id: "snap-diff",
      publishedWorkflowJson: snap2Json,
      originalWorkflowJson: snap1Json, // real baseline string → triggers diff computation
      workflowJson: snap2Json,
      createdAt: new Date("2024-01-02T00:00:00Z"),
    });

    render(
      <WorkflowArtifactPanel artifacts={[republishArtifact]} isActive={false} />,
    );

    // Editor tab is default — WorkflowComponent must receive Set instances for both props
    expect(lastWorkflowComponentProps.changedStepIds).toBeInstanceOf(Set);
    expect(lastWorkflowComponentProps.changedConnectionIds).toBeInstanceOf(Set);
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
    // Use a proper publish-snapshot artifact (brand-new first publish) so the
    // WORKFLOW item is emitted. A plain workflowJson-only artifact has no
    // publishedWorkflowJson and is correctly suppressed under the new gate.
    const snap1Json = makeWorkflowJson({ stepA: nonLoopTransition });
    const workflowArt = makeSnapshotArtifact({
      id: "snap-a",
      workflowId: 1,
      publishedWorkflowJson: snap1Json,
      originalWorkflowJson: null, // brand-new → all-green item
      workflowJson: snap1Json,
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

// ── countAddDel pure-function tests (object-typed workflowJson) ───────────────
// These import countAddDel directly to bypass the file-level vi.mock for ChangesList.

import { countAddDel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/changes/ChangesList";

describe("countAddDel — object inputs (regression: object-typed workflowJson)", () => {
  const workflowObj = {
    transitions: {
      stepA: { name: "A", timeout: 10 },
      stepB: { name: "B", input: "x" },
    },
    connections: [{ source: "stepA", target: "stepB" }],
  };

  it("returns non-negative integer counts for two plain workflow objects", () => {
    const result = countAddDel(workflowObj, { ...workflowObj, transitions: { stepA: { name: "A", timeout: 20 } } });
    expect(result.additions).toBeGreaterThanOrEqual(0);
    expect(result.deletions).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.additions)).toBe(true);
    expect(Number.isInteger(result.deletions)).toBe(true);
  });

  it("returns non-negative integer counts when updated is an object and original is null", () => {
    const result = countAddDel(null, workflowObj);
    expect(result.additions).toBeGreaterThanOrEqual(0);
    expect(result.deletions).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.additions)).toBe(true);
    expect(Number.isInteger(result.deletions)).toBe(true);
  });

  it("returns zero counts when updated is null (regardless of original type)", () => {
    const result = countAddDel(workflowObj, null);
    expect(result).toEqual({ additions: 0, deletions: 0 });
  });
});
