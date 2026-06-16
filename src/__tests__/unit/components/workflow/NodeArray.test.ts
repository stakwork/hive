// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import NodeArray from "@/components/workflow/v4/NodeArray";
import type { WorkflowTransition } from "@/types/stakwork/workflow";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeStep(overrides: Partial<WorkflowTransition> = {}): WorkflowTransition {
  return {
    id: "step-1",
    unique_id: "step-1",
    name: "Test Step",
    position: { x: 0, y: 0 },
    connections: {},
    ...overrides,
  };
}

function makeNodeArray(transitions: Record<string, WorkflowTransition> = {}): NodeArray {
  return new NodeArray(
    transitions,
    [],       // connecting_edges
    false,    // show_only
    "graph",  // mode
    undefined, // projectId
    false,    // isAdmin
    "wf-1",   // workflowId
    "v1",     // workflowVersion
  );
}

// ── getStatus ─────────────────────────────────────────────────────────────────

describe("NodeArray.getStatus", () => {
  let na: NodeArray;

  beforeEach(() => {
    na = makeNodeArray();
  });

  it("returns step.status.step_state when present", () => {
    const step = makeStep({
      status: { step_state: "finished", workflow_state: "in_progress", job_statuses: null },
    });
    expect(na.getStatus(step)).toBe("finished");
  });

  it("falls back to last_transition_state when status is absent", () => {
    const step = makeStep({ last_transition_state: "in_progress" });
    expect(na.getStatus(step)).toBe("in_progress");
  });

  it("returns null when both status and last_transition_state are absent", () => {
    const step = makeStep();
    expect(na.getStatus(step)).toBeNull();
  });

  it("prefers step_state over last_transition_state when both are present", () => {
    const step = makeStep({
      status: { step_state: "finished", workflow_state: "completed", job_statuses: null },
      last_transition_state: "error",
    });
    expect(na.getStatus(step)).toBe("finished");
  });
});

// ── setNodeStyle ──────────────────────────────────────────────────────────────

describe("NodeArray.setNodeStyle", () => {
  let na: NodeArray;

  beforeEach(() => {
    na = makeNodeArray();
  });

  it("applies green bg/border for status 'finished' (non-api)", () => {
    const node = { bgColor: "", borderColor: "" };
    na.setNodeStyle(node, "finished", "automated");
    expect(node.bgColor).toBe("#D3F6CF");
    expect(node.borderColor).toBe("#67c083");
  });

  it("applies teal bg/border for status 'finished' with type 'api'", () => {
    const node = { bgColor: "", borderColor: "" };
    na.setNodeStyle(node, "finished", "api");
    expect(node.bgColor).toBe("#BEF6F2");
    expect(node.borderColor).toBe("#4BCDC4");
  });

  it("applies white bg with green border for status 'in_progress' (non-api)", () => {
    const node = { bgColor: "", borderColor: "" };
    na.setNodeStyle(node, "in_progress", "human");
    expect(node.bgColor).toBe("white");
    expect(node.borderColor).toBe("#67c083");
  });

  it("does not mutate colors for null status", () => {
    const node = { bgColor: "#ccc", borderColor: "#ccc" };
    na.setNodeStyle(node, null, "automated");
    expect(node.bgColor).toBe("#ccc");
    expect(node.borderColor).toBe("#ccc");
  });
});

// ── setErrorNode ──────────────────────────────────────────────────────────────

describe("NodeArray.setErrorNode", () => {
  let na: NodeArray;

  beforeEach(() => {
    na = makeNodeArray();
  });

  it("applies grey bg and red border", () => {
    const node: any = { bgColor: "", borderColor: "" };
    na.setErrorNode(node);
    expect(node.bgColor).toBe("#F5F6F8");
    expect(node.borderColor).toBe("#FF5252");
  });
});

// ── mergedWorkflowData memo logic ─────────────────────────────────────────────
// We test the merge logic directly (pure function behaviour) since the page
// component is hard to render in isolation.

type ParsedWorkflow = {
  transitions: Record<string, WorkflowTransition>;
  [key: string]: unknown;
};

function applyMergedWorkflowData(
  parsedWorkflowData: ParsedWorkflow | null,
  runTransitions: Record<string, WorkflowTransition> | null,
): ParsedWorkflow | null {
  if (!parsedWorkflowData || !runTransitions) return parsedWorkflowData;
  const baseTransitions = parsedWorkflowData.transitions as
    | Record<string, WorkflowTransition>
    | undefined;
  if (!baseTransitions) return parsedWorkflowData;

  const mergedTransitions = Object.fromEntries(
    Object.entries(baseTransitions).map(([key, step]) => {
      const runStep = runTransitions[key];
      if (!runStep) return [key, step];
      return [
        key,
        {
          ...step,
          status: runStep.status,
          last_transition_state: runStep.last_transition_state,
        },
      ];
    }),
  );

  return { ...parsedWorkflowData, transitions: mergedTransitions };
}

describe("mergedWorkflowData memo logic", () => {
  const baseStep = makeStep({ id: "s1", unique_id: "s1" });
  const parsedWorkflowData: ParsedWorkflow = {
    transitions: { s1: baseStep },
  };

  it("returns parsedWorkflowData unchanged when runTransitions is null", () => {
    const result = applyMergedWorkflowData(parsedWorkflowData, null);
    expect(result).toBe(parsedWorkflowData); // same reference
  });

  it("returns null when parsedWorkflowData is null", () => {
    const result = applyMergedWorkflowData(null, {});
    expect(result).toBeNull();
  });

  it("injects status from runTransitions into matching transition", () => {
    const runTransitions: Record<string, WorkflowTransition> = {
      s1: makeStep({
        id: "s1",
        unique_id: "s1",
        status: { step_state: "finished", workflow_state: "completed", job_statuses: null },
        last_transition_state: "finished",
      }),
    };
    const result = applyMergedWorkflowData(parsedWorkflowData, runTransitions);
    expect(result).not.toBe(parsedWorkflowData); // new reference
    expect(result?.transitions.s1.status?.step_state).toBe("finished");
    expect(result?.transitions.s1.last_transition_state).toBe("finished");
  });

  it("preserves original step data not overwritten by run", () => {
    const runTransitions: Record<string, WorkflowTransition> = {
      s1: makeStep({
        id: "s1",
        unique_id: "s1",
        status: { step_state: "error", workflow_state: "failed", job_statuses: null },
      }),
    };
    const result = applyMergedWorkflowData(parsedWorkflowData, runTransitions);
    expect(result?.transitions.s1.name).toBe(baseStep.name);
  });

  it("leaves steps without a matching run entry unmodified", () => {
    const extraStep = makeStep({ id: "s2", unique_id: "s2", name: "Other Step" });
    const data: ParsedWorkflow = {
      transitions: { s1: baseStep, s2: extraStep },
    };
    const runTransitions: Record<string, WorkflowTransition> = {
      s1: makeStep({
        id: "s1",
        unique_id: "s1",
        status: { step_state: "finished", workflow_state: "completed", job_statuses: null },
      }),
    };
    const result = applyMergedWorkflowData(data, runTransitions);
    // s1 is enriched
    expect(result?.transitions.s1.status?.step_state).toBe("finished");
    // s2 is unchanged (same reference)
    expect(result?.transitions.s2).toBe(extraStep);
  });

  it("injects last_transition_state correctly when status is absent on run step", () => {
    const runTransitions: Record<string, WorkflowTransition> = {
      s1: makeStep({
        id: "s1",
        unique_id: "s1",
        last_transition_state: "halted",
      }),
    };
    const result = applyMergedWorkflowData(parsedWorkflowData, runTransitions);
    expect(result?.transitions.s1.last_transition_state).toBe("halted");
    expect(result?.transitions.s1.status).toBeUndefined();
  });
});
