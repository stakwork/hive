import { describe, it, expect } from "vitest";
import { mergeWorkflowRunStatus } from "@/lib/utils/merge-workflow-run-status";
import type { WorkflowTransition } from "@/types/stakwork/workflow";

function makeStep(
  id: string,
  name: string,
  extra: Partial<WorkflowTransition> = {},
): WorkflowTransition {
  return {
    id,
    name,
    unique_id: id,
    display_name: name,
    position: { x: 0, y: 0 },
    ...extra,
  } as WorkflowTransition;
}

function makeRunStep(
  id: string,
  name: string,
  stepState: string,
): WorkflowTransition {
  return {
    ...makeStep(id, name),
    status: { step_state: stepState, workflow_state: stepState, job_statuses: {} },
    last_transition_state: stepState,
  };
}

const finishedStatus = {
  step_state: "finished",
  workflow_state: "finished",
  job_statuses: {},
};

// ── Object-format base transitions ────────────────────────────────────────────

describe("mergeWorkflowRunStatus — object-format base transitions", () => {
  it("merges status from matching run step (same id)", () => {
    const base = {
      transitions: {
        step_one: makeStep("step-1", "step_one"),
        step_two: makeStep("step-2", "step_two"),
      },
    };
    const runTransitions = {
      "step-1": makeRunStep("step-1", "step_one", "finished"),
    };

    const result = mergeWorkflowRunStatus(base, runTransitions);
    const transitions = result.transitions as Record<string, WorkflowTransition>;

    expect(transitions.step_one.status?.step_state).toBe("finished");
    expect(transitions.step_one.last_transition_state).toBe("finished");
  });

  it("leaves steps absent from run transitions unchanged", () => {
    const original = makeStep("step-2", "step_two");
    const base = {
      transitions: {
        step_two: original,
      },
    };
    const runTransitions = {
      "step-1": makeRunStep("step-1", "step_one", "finished"),
    };

    const result = mergeWorkflowRunStatus(base, runTransitions);
    const transitions = result.transitions as Record<string, WorkflowTransition>;

    expect(transitions.step_two).toEqual(original);
    expect(transitions.step_two.status).toBeUndefined();
  });

  it("falls back to matching by step name when id doesn't match dict key", () => {
    // Dict key is "step_one" but step.id is "uuid-1"; run transition keyed by "uuid-1"
    const base = {
      transitions: {
        step_one: makeStep("uuid-1", "step_one"),
      },
    };
    const runTransitions = {
      "uuid-1": makeRunStep("uuid-1", "step_one", "error"),
    };

    const result = mergeWorkflowRunStatus(base, runTransitions);
    const transitions = result.transitions as Record<string, WorkflowTransition>;

    expect(transitions.step_one.status?.step_state).toBe("error");
  });

  it("returns base data unchanged when runTransitions is empty", () => {
    const base = {
      transitions: {
        step_one: makeStep("step-1", "step_one"),
      },
    };

    const result = mergeWorkflowRunStatus(base, {});
    const transitions = result.transitions as Record<string, WorkflowTransition>;

    expect(transitions.step_one.status).toBeUndefined();
  });

  it("returns base data unchanged when transitions key is missing", () => {
    const base = { name: "workflow-without-transitions" };
    const runTransitions = { "step-1": makeRunStep("step-1", "step_one", "finished") };

    const result = mergeWorkflowRunStatus(base, runTransitions);
    expect(result).toEqual(base);
  });
});

// ── Array-format base transitions ─────────────────────────────────────────────

describe("mergeWorkflowRunStatus — array-format base transitions", () => {
  it("merges status when run transitions are keyed by step id", () => {
    const base = {
      transitions: [
        makeStep("step-1", "step_one"),
        makeStep("step-2", "step_two"),
      ],
    };
    const runTransitions = {
      "step-1": makeRunStep("step-1", "step_one", "finished"),
      "step-2": makeRunStep("step-2", "step_two", "error"),
    };

    const result = mergeWorkflowRunStatus(base, runTransitions);
    const transitions = result.transitions as WorkflowTransition[];

    expect(Array.isArray(transitions)).toBe(true);
    expect(transitions[0].status?.step_state).toBe("finished");
    expect(transitions[1].status?.step_state).toBe("error");
  });

  it("merges status when run transitions are keyed by step name only", () => {
    const base = {
      transitions: [
        makeStep("step-1", "step_one"),
        makeStep("step-2", "step_two"),
      ],
    };
    // Run transitions only have name as lookup key (id in run differs from base)
    const runTransitions = {
      step_one: makeRunStep("run-id-1", "step_one", "finished"),
      step_two: makeRunStep("run-id-2", "step_two", "in_progress"),
    };

    const result = mergeWorkflowRunStatus(base, runTransitions);
    const transitions = result.transitions as WorkflowTransition[];

    expect(transitions[0].status?.step_state).toBe("finished");
    expect(transitions[1].status?.step_state).toBe("in_progress");
  });

  it("leaves array steps absent from run transitions unchanged", () => {
    const original = makeStep("step-2", "step_two");
    const base = {
      transitions: [
        makeStep("step-1", "step_one"),
        original,
      ],
    };
    const runTransitions = {
      "step-1": makeRunStep("step-1", "step_one", "finished"),
    };

    const result = mergeWorkflowRunStatus(base, runTransitions);
    const transitions = result.transitions as WorkflowTransition[];

    expect(transitions[1].status).toBeUndefined();
    expect(transitions[1].name).toBe("step_two");
  });

  it("preserves array order after merge", () => {
    const base = {
      transitions: [
        makeStep("s1", "alpha"),
        makeStep("s2", "beta"),
        makeStep("s3", "gamma"),
      ],
    };
    const runTransitions = {
      s2: makeRunStep("s2", "beta", "finished"),
    };

    const result = mergeWorkflowRunStatus(base, runTransitions);
    const transitions = result.transitions as WorkflowTransition[];

    expect(transitions.map((t) => t.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(transitions[1].status?.step_state).toBe("finished");
  });
});

// ── Run transitions as array ──────────────────────────────────────────────────

describe("mergeWorkflowRunStatus — run transitions as array", () => {
  it("indexes run transitions by id when passed as an array", () => {
    const base = {
      transitions: {
        step_one: makeStep("step-1", "step_one"),
      },
    };
    const runTransitionsArray: WorkflowTransition[] = [
      makeRunStep("step-1", "step_one", "finished"),
    ];

    const result = mergeWorkflowRunStatus(base, runTransitionsArray);
    const transitions = result.transitions as Record<string, WorkflowTransition>;

    expect(transitions.step_one.status?.step_state).toBe("finished");
  });
});
