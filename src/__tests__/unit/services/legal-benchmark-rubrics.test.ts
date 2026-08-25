/**
 * Unit tests for legal-benchmark-rubrics.ts — contest-rationale fan-out.
 *
 * Covers the `fetchEvalSetRubrics` service's HAS_CRITERION_RESULT fan-out:
 * - contested requirements walk HAS_CRITERION_RESULT and get a rationale
 * - non-contested requirements are NOT walked (no extra fetch)
 * - `expandEdges` failure yields rubrics with no reason (degrade, never fail)
 * - selection rule: multiple children, all children empty, single child,
 *   unparseable/tied suffix
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock expandEdges ──────────────────────────────────────────────────────────
vi.mock("@/lib/harvey-lab/jarvis-expand", () => ({
  expandEdges: vi.fn(),
}));

// ── Mock logger ───────────────────────────────────────────────────────────────
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

// ── Mock resolveEvalSetRefIdBySlug ────────────────────────────────────────────
vi.mock("@/services/legal-benchmark-recursion", () => ({
  resolveEvalSetRefIdBySlug: vi.fn().mockResolvedValue("evalset-ref-1"),
}));

import { expandEdges } from "@/lib/harvey-lab/jarvis-expand";
import { fetchEvalSetRubrics } from "@/services/legal-benchmark-rubrics";
import type { JarvisConnectionConfig } from "@/types/jarvis";

const mockExpandEdges = vi.mocked(expandEdges);

const config: JarvisConnectionConfig = {
  jarvisUrl: "https://mock-jarvis",
  apiKey: "test-key",
};

/** Build a minimal JarvisNode for an EvalRequirement */
function evalReqNode(id: string, contested: boolean, refId = `req-${id}`) {
  return {
    ref_id: refId,
    node_type: "EvalRequirement",
    properties: { id, name: `Rubric ${id}`, contested },
  };
}

/** Build a minimal JarvisNode for a CriterionResult */
function criterionResultNode(id: string, llmReason: string, excerpt = "", refId = `cr-${id}`) {
  return {
    ref_id: refId,
    node_type: "criterionresult",
    properties: { id, llm_flag_reason: llmReason, document_excerpt: excerpt },
  };
}

/**
 * Setup a global fetch mock that returns a set of EvalRequirement nodes.
 */
function mockFetch(requirementNodes: ReturnType<typeof evalReqNode>[]) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({ nodes: requirementNodes }),
  } as unknown as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchEvalSetRubrics — contest rationale fan-out", () => {
  it("non-contested requirements are NOT walked via expandEdges", async () => {
    mockFetch([evalReqNode("C-001", false)]);
    mockExpandEdges.mockResolvedValue([]);

    const result = await fetchEvalSetRubrics(config, "evalset-ref-1");
    expect(result.ok).toBe(true);
    expect(result.rubrics).toHaveLength(1);
    // No contested rubrics → expandEdges must never be called
    expect(mockExpandEdges).not.toHaveBeenCalled();
  });

  it("contested requirements get a rationale when CriterionResult is found", async () => {
    mockFetch([evalReqNode("C-001", true)]);
    mockExpandEdges.mockResolvedValue([
      criterionResultNode("C-001", "This criterion is ambiguous", "Excerpt text"),
    ]);

    const result = await fetchEvalSetRubrics(config, "evalset-ref-1");
    expect(result.ok).toBe(true);
    const rubric = result.rubrics?.find((r) => r.id === "C-001");
    expect(rubric).toBeDefined();
    expect(rubric?.contestReason).toBe("This criterion is ambiguous");
    expect(rubric?.contestExcerpt).toBe("Excerpt text");
  });

  it("expandEdges failure yields rubrics with no reason (degrade, never fail)", async () => {
    mockFetch([evalReqNode("C-002", true)]);
    mockExpandEdges.mockResolvedValue(null); // null = failure from expandEdges

    const result = await fetchEvalSetRubrics(config, "evalset-ref-1");
    expect(result.ok).toBe(true);
    const rubric = result.rubrics?.find((r) => r.id === "C-002");
    expect(rubric).toBeDefined();
    expect(rubric?.contestReason).toBeUndefined();
    expect(rubric?.contestExcerpt).toBeUndefined();
  });

  it("selection rule: picks child with highest numeric run-suffix", async () => {
    mockFetch([evalReqNode("C-003", true)]);
    mockExpandEdges.mockResolvedValue([
      criterionResultNode("C-003", "Older reason", "", "cr-C-003-100"),
      criterionResultNode("C-003", "Newer reason", "", "cr-C-003-200"),
    ]);

    const result = await fetchEvalSetRubrics(config, "evalset-ref-1");
    const rubric = result.rubrics?.find((r) => r.id === "C-003");
    // "cr-C-003-200" has the highest suffix → "Newer reason" wins
    expect(rubric?.contestReason).toBe("Newer reason");
  });

  it("selection rule: all children have empty llm_flag_reason → no rationale", async () => {
    mockFetch([evalReqNode("C-004", true)]);
    mockExpandEdges.mockResolvedValue([
      { ref_id: "cr-1", node_type: "criterionresult", properties: { id: "C-004", llm_flag_reason: "" } },
      { ref_id: "cr-2", node_type: "criterionresult", properties: { id: "C-004", llm_flag_reason: "   " } },
    ]);

    const result = await fetchEvalSetRubrics(config, "evalset-ref-1");
    const rubric = result.rubrics?.find((r) => r.id === "C-004");
    expect(rubric?.contestReason).toBeUndefined();
  });

  it("selection rule: single child → that child is selected", async () => {
    mockFetch([evalReqNode("C-005", true)]);
    mockExpandEdges.mockResolvedValue([
      criterionResultNode("C-005", "Only reason"),
    ]);

    const result = await fetchEvalSetRubrics(config, "evalset-ref-1");
    const rubric = result.rubrics?.find((r) => r.id === "C-005");
    expect(rubric?.contestReason).toBe("Only reason");
  });

  it("selection rule: unparseable suffix → stable fallback by ref_id desc", async () => {
    mockFetch([evalReqNode("C-006", true)]);
    // Both have non-numeric suffixes; should fall back to ref_id lexicographic sort (desc)
    mockExpandEdges.mockResolvedValue([
      { ref_id: "cr-aaa", node_type: "criterionresult", properties: { id: "C-006", llm_flag_reason: "Reason A" } },
      { ref_id: "cr-zzz", node_type: "criterionresult", properties: { id: "C-006", llm_flag_reason: "Reason Z" } },
    ]);

    const result = await fetchEvalSetRubrics(config, "evalset-ref-1");
    const rubric = result.rubrics?.find((r) => r.id === "C-006");
    // zzz > aaa lexicographically (desc) → "Reason Z" wins
    expect(rubric?.contestReason).toBe("Reason Z");
  });

  it("nodes with wrong node_type are filtered out", async () => {
    mockFetch([evalReqNode("C-007", true)]);
    mockExpandEdges.mockResolvedValue([
      { ref_id: "other-1", node_type: "EvalRequirement", properties: { id: "C-007", llm_flag_reason: "Wrong type" } },
    ]);

    const result = await fetchEvalSetRubrics(config, "evalset-ref-1");
    const rubric = result.rubrics?.find((r) => r.id === "C-007");
    expect(rubric?.contestReason).toBeUndefined();
  });
});

// ─── RubricLedger dedupe / card render integration (via RubricLedger.test.tsx) ──
// The dedupe test (byte-equal rationale renders once) and card render tests
// (rationale+excerpt present/absent) are in RubricLedger.test.tsx below.
