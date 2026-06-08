/**
 * Utility functions for extracting and diffing set_var params from workflow JSON.
 * Reuses parseWorkflowJson and normaliseTransitions from workflow-diff.ts.
 */

import { parseWorkflowJson, normaliseTransitions } from "@/lib/utils/workflow-diff";

/**
 * Extracts all set_var params/vars from a workflow JSON string.
 * Walks all transitions and collects `step.attributes.vars` / `attributes.vars`.
 * Returns {} on any parse failure, null input, or when no transitions have vars.
 */
export function extractSetVarParams(workflowJson: string | null): Record<string, unknown> {
  const parsed = parseWorkflowJson(workflowJson);
  if (!parsed) return {};

  const transitions = normaliseTransitions(parsed.transitions);
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(transitions)) {
    const entry = transitions[key];
    if (!entry || typeof entry !== "object") continue;

    const t = entry as Record<string, unknown>;

    // Check step.attributes.vars
    const step = t.step as Record<string, unknown> | undefined;
    const stepVars =
      step?.attributes && typeof step.attributes === "object"
        ? (step.attributes as Record<string, unknown>).vars
        : undefined;

    // Check attributes.vars (top-level on the transition)
    const topVars =
      t.attributes && typeof t.attributes === "object"
        ? (t.attributes as Record<string, unknown>).vars
        : undefined;

    for (const vars of [stepVars, topVars]) {
      if (vars && typeof vars === "object" && !Array.isArray(vars)) {
        const varsObj = vars as Record<string, unknown>;
        if (Object.keys(varsObj).length > 0) {
          Object.assign(result, varsObj);
        }
      }
    }
  }

  return result;
}

export interface SetVarDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

/**
 * Diffs the set_var params between two workflow JSON versions.
 * When prevJson is null (first version), all keys in next are "added".
 * Returns { added: [], removed: [], modified: [] } when inputs are equivalent.
 */
export function diffSetVarParams(prevJson: string | null, nextJson: string | null): SetVarDiff {
  const nextVars = extractSetVarParams(nextJson);
  const nextKeys = Object.keys(nextVars);

  if (prevJson === null) {
    // First version — everything in next is "added"
    return { added: nextKeys, removed: [], modified: [] };
  }

  const prevVars = extractSetVarParams(prevJson);
  const prevKeysSet = new Set(Object.keys(prevVars));
  const nextKeysSet = new Set(nextKeys);

  const added = nextKeys.filter((k) => !prevKeysSet.has(k));
  const removed = [...prevKeysSet].filter((k) => !nextKeysSet.has(k));
  const modified = nextKeys.filter(
    (k) => prevKeysSet.has(k) && JSON.stringify(prevVars[k]) !== JSON.stringify(nextVars[k]),
  );

  return { added, removed, modified };
}
