/**
 * ensureWorkflowBenchmarkEvalNodes — every Jarvis attribute search bypasses
 * Jarvis's in-process search cache.
 *
 * Seen live on swarm38: the read-before-write ran seconds before the
 * EvalSet write and cached "no such EvalSet"; the post-upsert resolve then
 * served that miss, returned null, and the dispatch route recorded
 * rosterUpsertOutcome "ok" with no roster in the graph. The rubrics reader
 * kept hitting the same cached miss, so every score cell said "No rubric
 * roster" although the node existed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSearch = vi.hoisted(() => vi.fn());
const mockAddNodeBulk = vi.hoisted(() => vi.fn());
const mockAddEdge = vi.hoisted(() => vi.fn());
const mockDeleteNode = vi.hoisted(() => vi.fn());

vi.mock("@/services/swarm/api/nodes", () => ({
  searchNodesByAttributes: mockSearch,
  addNodeBulk: mockAddNodeBulk,
  addEdge: mockAddEdge,
  deleteNode: mockDeleteNode,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ensureWorkflowBenchmarkEvalNodes } from "@/lib/workflow-benchmarks/eval-nodes";

const CONFIG = { jarvisUrl: "https://swarm.example.com:8444", apiKey: "k" };
const TASK = {
  slug: "wfbench/generate-capital-city",
  section: "llm",
  title: "Create a workflow that answers a country's capital city",
  instructions: "…",
  criteria: [
    { id: "C-001", title: "a", match_criteria: "…" },
    { id: "C-002", title: "b", match_criteria: "…" },
  ],
} as Parameters<typeof ensureWorkflowBenchmarkEvalNodes>[1];

describe("ensureWorkflowBenchmarkEvalNodes — Jarvis search cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddNodeBulk.mockResolvedValue({ success: true, errors: [] });
    mockAddEdge.mockResolvedValue({ success: true });
    // 1st search: read-before-write (nothing there); 2nd: resolve the EvalSet
    // just written; 3rd: resolve the requirements just written.
    mockSearch
      .mockResolvedValueOnce({ ok: true, nodes: [] })
      .mockResolvedValueOnce({
        ok: true,
        nodes: [{ ref_id: "es-1", node_type: "EvalSet", properties: { id: TASK.slug } }],
      })
      .mockResolvedValueOnce({
        ok: true,
        nodes: TASK.criteria.map((c, i) => ({
          ref_id: `req-${i}`,
          node_type: "EvalRequirement",
          properties: { id: `${TASK.slug}::${c.id}`, corpus: "workflow-benchmarks" },
        })),
      });
  });

  it("passes skipCache: true on every searchNodesByAttributes call", async () => {
    const refs = await ensureWorkflowBenchmarkEvalNodes(CONFIG, TASK);
    expect(refs?.evalSetRef).toBe("es-1");
    expect(mockSearch).toHaveBeenCalledTimes(3);
    for (const call of mockSearch.mock.calls) {
      const params = call[1] as { skipCache?: boolean; nodeTypes: string[] };
      expect(params.skipCache, `search for ${params.nodeTypes.join("/")}`).toBe(true);
    }
  });
});
