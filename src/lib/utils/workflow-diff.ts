/**
 * Utility for computing structural diffs between two workflow JSON payloads.
 * Returns sets of changed step IDs and connection IDs for highlight purposes.
 */

function parseWorkflowJson(jsonString: string | null): Record<string, unknown> | null {
  if (!jsonString) return null;

  try {
    let data: unknown = jsonString;

    // Handle double-encoded JSON (same logic as WorkflowChangesPanel parseAndFormat)
    if (typeof data === "string") {
      if (data.startsWith('\\"') && data.endsWith('\\"')) {
        data = data.slice(2, -2);
      } else if (data.startsWith('"') && data.endsWith('"')) {
        data = data.slice(1, -1);
      }

      while (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          break;
        }
      }
    }

    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }

    return null;
  } catch {
    return null;
  }
}

function omitPosition(step: unknown): unknown {
  if (step && typeof step === "object" && !Array.isArray(step)) {
    const { position: _position, ...rest } = step as Record<string, unknown>;
    return rest;
  }
  return step;
}

function omitConnectionMeta(conn: unknown): unknown {
  if (conn && typeof conn === "object" && !Array.isArray(conn)) {
    const { id: _id, ...rest } = conn as Record<string, unknown>;
    return rest;
  }
  return conn;
}

function normaliseTransitions(raw: unknown): Record<string, unknown> {
  if (Array.isArray(raw)) {
    const result: Record<string, unknown> = {};
    for (const step of raw) {
      if (step && typeof step === "object") {
        const s = step as Record<string, unknown>;
        const key = String(s.id ?? s.unique_id ?? Object.keys(result).length);
        result[key] = s;
      }
    }
    return result;
  }
  return (raw ?? {}) as Record<string, unknown>;
}

export function computeWorkflowDiff(
  originalJson: string | null,
  updatedJson: string | null,
): { changedStepIds: Set<string>; changedConnectionIds: Set<string> } {
  const empty = { changedStepIds: new Set<string>(), changedConnectionIds: new Set<string>() };

  const original = parseWorkflowJson(originalJson);
  const updated = parseWorkflowJson(updatedJson);

  if (!original || !updated) return empty;

  const changedStepIds = new Set<string>();
  const changedConnectionIds = new Set<string>();

  // Diff transitions (steps) by key
  const origTransitions = normaliseTransitions(original.transitions);
  const updatedTransitions = normaliseTransitions(updated.transitions);

  const allStepKeys = new Set([...Object.keys(origTransitions), ...Object.keys(updatedTransitions)]);

  for (const key of allStepKeys) {
    const inOrig = key in origTransitions;
    const inUpdated = key in updatedTransitions;

    if (!inOrig || !inUpdated) {
      // Added or removed
      changedStepIds.add(key);
      const stepVal = (inUpdated ? updatedTransitions[key] : origTransitions[key]) as Record<string, unknown> | null;
      const stepId = stepVal?.id as string | undefined;
      if (stepId && stepId !== key) changedStepIds.add(stepId);
    } else if (JSON.stringify(omitPosition(origTransitions[key])) !== JSON.stringify(omitPosition(updatedTransitions[key]))) {
      // Modified
      changedStepIds.add(key);
      const stepVal = updatedTransitions[key] as Record<string, unknown> | null;
      const stepId = stepVal?.id as string | undefined;
      if (stepId && stepId !== key) changedStepIds.add(stepId);
    }
  }

  // Diff connections by source-target composite key
  const toConnectionMap = (connections: unknown): Map<string, unknown> => {
    const map = new Map<string, unknown>();
    if (!Array.isArray(connections)) return map;

    for (const conn of connections) {
      if (conn && typeof conn === "object") {
        const c = conn as Record<string, unknown>;
        const source = String(c.source ?? "");
        const target = String(c.target ?? "");
        if (source && target) {
          map.set(`${source}-${target}`, conn);
        }
      }
    }

    return map;
  };

  const origConns = toConnectionMap(original.connections);
  const updatedConns = toConnectionMap(updated.connections);
  const allConnKeys = new Set([...origConns.keys(), ...updatedConns.keys()]);

  for (const key of allConnKeys) {
    const inOrig = origConns.has(key);
    const inUpdated = updatedConns.has(key);

    if (!inOrig || !inUpdated) {
      changedConnectionIds.add(key);
    } else if (JSON.stringify(omitConnectionMeta(origConns.get(key))) !== JSON.stringify(omitConnectionMeta(updatedConns.get(key)))) {
      changedConnectionIds.add(key);
    }
  }

  return { changedStepIds, changedConnectionIds };
}
