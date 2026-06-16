import type { WorkflowTransition } from "@/types/stakwork/workflow";

/**
 * Merges run-specific step statuses into the base workflow data.
 *
 * Handles both object-format (`Record<string, WorkflowTransition>`) and
 * array-format (`WorkflowTransition[]`) base transitions, and looks up run
 * steps by both `id` and `name` to cover diverging key conventions.
 */
export function mergeWorkflowRunStatus(
  parsedWorkflowData: Record<string, unknown>,
  runTransitions: Record<string, WorkflowTransition> | WorkflowTransition[],
): Record<string, unknown> {
  const baseTransitions = parsedWorkflowData.transitions as
    | Record<string, WorkflowTransition>
    | WorkflowTransition[]
    | undefined;
  if (!baseTransitions) return parsedWorkflowData;

  // Build fast lookup from run transitions: keyed by id AND name
  const byId: Record<string, WorkflowTransition> = {};
  const byName: Record<string, WorkflowTransition> = {};
  const runSteps = Array.isArray(runTransitions)
    ? runTransitions
    : Object.values(runTransitions);
  for (const rs of runSteps as WorkflowTransition[]) {
    if (rs.id) byId[rs.id] = rs;
    if (rs.name) byName[rs.name] = rs;
  }

  const enrichStep = (key: string, step: WorkflowTransition): WorkflowTransition => {
    const rs = byId[step.id] ?? byName[step.name] ?? byId[key] ?? byName[key] ?? null;
    if (!rs) return step;
    return { ...step, status: rs.status, last_transition_state: rs.last_transition_state };
  };

  if (Array.isArray(baseTransitions)) {
    return {
      ...parsedWorkflowData,
      transitions: (baseTransitions as WorkflowTransition[]).map((s, i) =>
        enrichStep(String(i), s),
      ),
    };
  }

  return {
    ...parsedWorkflowData,
    transitions: Object.fromEntries(
      Object.entries(baseTransitions as Record<string, WorkflowTransition>).map(([k, s]) => [
        k,
        enrichStep(k, s),
      ]),
    ),
  };
}
