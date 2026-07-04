/**
 * Unit tests for prompt usage/run-count groupBy aggregation logic.
 *
 * The live-Stakwork helpers (fetchPromptUsagesByName, fetchVersionRunCount)
 * have been removed and replaced by local mirror table queries. This file
 * verifies the in-memory grouping and deduplication logic that replaces them.
 */
import { describe, test, expect } from "vitest";

// ─── In-memory grouping logic (mirrors route.ts implementation) ───────────────

type RawUsageRow = {
  promptName: string;
  workflowId: number;
  workflowName: string | null;
  stepId: string;
};

function groupUsagesByName(rows: RawUsageRow[]) {
  const map = new Map<string, Array<{ workflow_id: number; workflow_name: string; step_id: string }>>();
  for (const u of rows) {
    const key = `${u.workflowId}:${u.stepId}`;
    const entry = { workflow_id: u.workflowId, workflow_name: u.workflowName ?? "", step_id: u.stepId };
    if (!map.has(u.promptName)) map.set(u.promptName, []);
    const list = map.get(u.promptName)!;
    if (!list.some((x) => `${x.workflow_id}:${x.step_id}` === key)) {
      list.push(entry);
    }
  }
  return map;
}

describe("groupUsagesByName (in-memory dedup logic)", () => {
  test("groups rows by promptName", () => {
    const rows: RawUsageRow[] = [
      { promptName: "PROMPT_A", workflowId: 1, workflowName: "Flow A", stepId: "s1" },
      { promptName: "PROMPT_B", workflowId: 2, workflowName: "Flow B", stepId: "s2" },
      { promptName: "PROMPT_A", workflowId: 3, workflowName: "Flow C", stepId: "s3" },
    ];
    const map = groupUsagesByName(rows);
    expect(map.get("PROMPT_A")).toHaveLength(2);
    expect(map.get("PROMPT_B")).toHaveLength(1);
  });

  test("deduplicates rows with same (workflowId, stepId)", () => {
    const rows: RawUsageRow[] = [
      { promptName: "PROMPT_A", workflowId: 1, workflowName: "Flow A", stepId: "s1" },
      { promptName: "PROMPT_A", workflowId: 1, workflowName: "Flow A", stepId: "s1" }, // duplicate
      { promptName: "PROMPT_A", workflowId: 1, workflowName: "Flow A (updated)", stepId: "s1" }, // same key, different name
    ];
    const map = groupUsagesByName(rows);
    expect(map.get("PROMPT_A")).toHaveLength(1);
  });

  test("maps workflowName null to empty string", () => {
    const rows: RawUsageRow[] = [
      { promptName: "PROMPT_A", workflowId: 1, workflowName: null, stepId: "s1" },
    ];
    const map = groupUsagesByName(rows);
    expect(map.get("PROMPT_A")![0].workflow_name).toBe("");
  });

  test("returns empty map for empty input", () => {
    const map = groupUsagesByName([]);
    expect(map.size).toBe(0);
  });

  test("maps field names correctly to API shape", () => {
    const rows: RawUsageRow[] = [
      { promptName: "MY_PROMPT", workflowId: 42, workflowName: "My Flow", stepId: "step_99" },
    ];
    const map = groupUsagesByName(rows);
    expect(map.get("MY_PROMPT")![0]).toEqual({
      workflow_id: 42,
      workflow_name: "My Flow",
      step_id: "step_99",
    });
  });
});
