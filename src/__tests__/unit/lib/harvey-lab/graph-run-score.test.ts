/**
 * Unit tests for graph-run-score.ts — the pure join between Runs-tab rows and
 * graph EvalTriggerOutput nodes.
 *
 * Contract under test:
 *   resolveGraphOutputForRun({ evalTriggerRef?, projectId? }, outputs) → output | null
 *
 * Joins covered:
 *   - evalTriggerRef exact match (manual rows)
 *   - projectId `--<suffix>` id match (recursion re-run rows)
 *   - precedence: trigger match beats projectId match
 *   - unusable outputs (no counts / zero total) are skipped
 *   - newest output wins when a trigger re-scored
 *   - null when nothing joins (caller falls back to result-table fields)
 */
import { describe, it, expect } from "vitest";
import {
  resolveGraphOutputForRun,
  type GraphScoreOutput,
} from "@/lib/harvey-lab/graph-run-score";

function output(overrides: Partial<GraphScoreOutput> = {}): GraphScoreOutput {
  return {
    ref_id: "out-1",
    triggerRef: "trigger-1",
    attempt_number: 1,
    result: "fail",
    score: 0.7,
    n_passed: 7,
    n_total: 10,
    date_added_to_graph: "1760000000",
    ...overrides,
  };
}

describe("resolveGraphOutputForRun", () => {
  it("joins a manual row by its evalTriggerRef", () => {
    const outputs = [output(), output({ ref_id: "out-2", triggerRef: "trigger-2", n_passed: 3 })];
    const resolved = resolveGraphOutputForRun({ evalTriggerRef: "trigger-2" }, outputs);
    expect(resolved?.ref_id).toBe("out-2");
    expect(resolved?.n_passed).toBe(3);
  });

  it("joins a recursion row by projectId id-suffix when it has no trigger ref", () => {
    const outputs = [
      output({ ref_id: "out-base", id: "task-a-src" }),
      output({ ref_id: "out-rerun", id: "task-a-src--57419", n_passed: 8 }),
    ];
    const resolved = resolveGraphOutputForRun({ projectId: 57419 }, outputs);
    expect(resolved?.ref_id).toBe("out-rerun");
  });

  it("does not suffix-match a different project id", () => {
    const outputs = [output({ id: "task-a-src--57419" })];
    expect(resolveGraphOutputForRun({ projectId: 7419 }, outputs)).toBeNull();
  });

  it("prefers the trigger join over the projectId join", () => {
    const outputs = [
      output({ ref_id: "by-trigger", triggerRef: "trigger-1" }),
      output({ ref_id: "by-project", triggerRef: "other", id: "x--42" }),
    ];
    const resolved = resolveGraphOutputForRun(
      { evalTriggerRef: "trigger-1", projectId: 42 },
      outputs,
    );
    expect(resolved?.ref_id).toBe("by-trigger");
  });

  it("falls through to the projectId join when the trigger match has no usable counts", () => {
    const outputs = [
      output({ ref_id: "no-counts", triggerRef: "trigger-1", n_passed: undefined, n_total: undefined }),
      output({ ref_id: "by-project", triggerRef: "other", id: "x--42" }),
    ];
    const resolved = resolveGraphOutputForRun(
      { evalTriggerRef: "trigger-1", projectId: 42 },
      outputs,
    );
    expect(resolved?.ref_id).toBe("by-project");
  });

  it("skips zero-total outputs (degenerate 0/0 writes)", () => {
    const outputs = [output({ n_passed: 0, n_total: 0 })];
    expect(resolveGraphOutputForRun({ evalTriggerRef: "trigger-1" }, outputs)).toBeNull();
  });

  it("picks the newest output when a trigger scored more than once", () => {
    const outputs = [
      output({ ref_id: "old", date_added_to_graph: "1760000000", n_passed: 5 }),
      output({ ref_id: "new", date_added_to_graph: "1760009999", n_passed: 9 }),
    ];
    const resolved = resolveGraphOutputForRun({ evalTriggerRef: "trigger-1" }, outputs);
    expect(resolved?.ref_id).toBe("new");
  });

  it("returns null for empty/absent output lists and joinless rows", () => {
    expect(resolveGraphOutputForRun({ evalTriggerRef: "t" }, [])).toBeNull();
    expect(resolveGraphOutputForRun({ evalTriggerRef: "t" }, null)).toBeNull();
    expect(resolveGraphOutputForRun({}, [output()])).toBeNull();
  });
});
