// Dev-only synthetic run data for the workflow run view. Mirrors the step ids
// produced by the mock versions endpoint so merge-by-id lights up each card
// with a run status (finished → green, in_progress → pulse, error/halted).

type Outcome = "success" | "error" | "halted" | "active";

// Run ids surfaced by the mock runs endpoint, mapped to how they should render.
const RUN_OUTCOME: Record<number, Outcome> = {
  88012: "active",
  88008: "success",
  88004: "error",
  87990: "success",
  87955: "halted",
  87901: "success",
  87870: "success",
  87844: "success",
  87810: "success",
  87777: "error",
  1001: "success",
  1002: "error",
  1003: "success",
  2001: "halted",
  2002: "active",
};

// Ordered to match the mock workflow_json chain.
const STEP_IDS = [
  "trigger_webhook",
  "set_model_config",
  "check_prototype_mode",
  "call_stakwork_api",
  "parse_response",
  "ask_clarification",
  "user_approved",
  "iterate_files",
  "set_feature_title",
];

const TIMINGS = [0.3, 0.18, 0.05, 0.42, 0.14, 1.1, 0.6, 161, 0.09];

interface RunStepStatus {
  step_state: string;
  workflow_state?: string;
  job_statuses?: { completion_time?: { value: number }; start_time?: { value: string } };
}

function finished(i: number, workflowState?: string): RunStepStatus {
  return {
    step_state: "finished",
    ...(workflowState ? { workflow_state: workflowState } : {}),
    job_statuses: { completion_time: { value: TIMINGS[i] ?? 0.2 } },
  };
}

export function buildMockRunWorkflowData(projectId: string) {
  const runId = parseInt(projectId, 10);
  const outcome: Outcome = RUN_OUTCOME[runId] ?? "success";

  // Index at which the run stops advancing (for non-success outcomes).
  const stopAt =
    outcome === "error" ? 3 : outcome === "halted" ? 6 : outcome === "active" ? 5 : STEP_IDS.length;
  const workflowState =
    outcome === "success" ? "completed" : outcome === "halted" ? "halted" : undefined;

  const transitions: Record<string, { id: string; status: RunStepStatus }> = {};
  for (let i = 0; i < STEP_IDS.length; i++) {
    const id = STEP_IDS[i];
    if (i < stopAt) {
      transitions[id] = { id, status: finished(i, workflowState) };
    } else if (i === stopAt && outcome !== "success") {
      const state = outcome === "error" ? "error" : outcome === "halted" ? "halted" : "in_progress";
      transitions[id] = {
        id,
        status: { step_state: state, ...(workflowState ? { workflow_state: workflowState } : {}) },
      };
    }
    // remaining steps stay unstarted (no status) for non-success runs
  }

  return {
    workflowData: { transitions, project: { workflow_state: workflowState ?? "running" } },
    status: workflowState ?? "running",
  };
}
