import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

// ── Stable mock refs ──────────────────────────────────────────────────────────

const mockAddNode = vi.hoisted(() => vi.fn());
const mockAddEdge = vi.hoisted(() => vi.fn());

vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: mockAddNode,
  addEdge: mockAddEdge,
}));

import {
  fetchHarveyTaskCriteria,
  ensureHarveyLabEvalNodes,
} from "@/lib/harvey-lab/eval-nodes";
import type { JarvisConnectionConfig } from "@/types/jarvis";

// ── Helpers ───────────────────────────────────────────────────────────────────

const JARVIS_CONFIG: JarvisConnectionConfig = {
  jarvisUrl: "https://jarvis.example.com",
  apiKey: "test-api-key",
};

function nodeSuccess(ref_id: string) {
  return { success: true, ref_id };
}

function nodeAlreadyExists(ref_id: string) {
  return { success: true, ref_id, alreadyExists: true };
}

function nodeFailure(error = "Jarvis error") {
  return { success: false, error };
}

// ═══════════════════════════════════════════════════════════════════════════
// fetchHarveyTaskCriteria
// ═══════════════════════════════════════════════════════════════════════════

describe("fetchHarveyTaskCriteria", () => {
  const ORIGINAL_BASE_URL = process.env.HARVEY_LAB_TASKS_BASE_URL;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_BASE_URL === undefined) {
      delete process.env.HARVEY_LAB_TASKS_BASE_URL;
    } else {
      process.env.HARVEY_LAB_TASKS_BASE_URL = ORIGINAL_BASE_URL;
    }
  });

  test("returns [] when HARVEY_LAB_TASKS_BASE_URL is not set", async () => {
    delete process.env.HARVEY_LAB_TASKS_BASE_URL;
    const result = await fetchHarveyTaskCriteria("task-slug-1");
    expect(result).toEqual([]);
  });

  test("returns [] when fetch fails (non-ok response)", async () => {
    process.env.HARVEY_LAB_TASKS_BASE_URL = "https://raw.example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const result = await fetchHarveyTaskCriteria("task-slug-1");
    expect(result).toEqual([]);
  });

  test("returns [] when fetch throws", async () => {
    process.env.HARVEY_LAB_TASKS_BASE_URL = "https://raw.example.com";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const result = await fetchHarveyTaskCriteria("task-slug-1");
    expect(result).toEqual([]);
  });

  test("returns [] when response body is not valid JSON", async () => {
    process.env.HARVEY_LAB_TASKS_BASE_URL = "https://raw.example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new Error("invalid JSON"); },
    }));

    const result = await fetchHarveyTaskCriteria("task-slug-1");
    expect(result).toEqual([]);
  });

  test("returns [] when criteria field is missing", async () => {
    process.env.HARVEY_LAB_TASKS_BASE_URL = "https://raw.example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "Some Task" }),
    }));

    const result = await fetchHarveyTaskCriteria("task-slug-1");
    expect(result).toEqual([]);
  });

  test("returns [] when criteria is not an array", async () => {
    process.env.HARVEY_LAB_TASKS_BASE_URL = "https://raw.example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ criteria: "not-an-array" }),
    }));

    const result = await fetchHarveyTaskCriteria("task-slug-1");
    expect(result).toEqual([]);
  });

  test("extracts match_criteria strings from valid response", async () => {
    process.env.HARVEY_LAB_TASKS_BASE_URL = "https://raw.example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        criteria: [
          { id: "c1", title: "Criterion 1", match_criteria: "Must identify party A", deliverables: [] },
          { id: "c2", title: "Criterion 2", match_criteria: "Must extract clause B", deliverables: ["doc.pdf"] },
          { id: "c3", title: "Criterion 3", match_criteria: "Must summarize section C", deliverables: [] },
        ],
      }),
    }));

    const result = await fetchHarveyTaskCriteria("task-slug-1");
    expect(result).toEqual([
      "Must identify party A",
      "Must extract clause B",
      "Must summarize section C",
    ]);
  });

  test("filters out entries with falsy match_criteria", async () => {
    process.env.HARVEY_LAB_TASKS_BASE_URL = "https://raw.example.com";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        criteria: [
          { id: "c1", match_criteria: "Valid criterion" },
          { id: "c2", match_criteria: "" },
          { id: "c3", match_criteria: null },
          { id: "c4", match_criteria: "Another valid one" },
        ],
      }),
    }));

    const result = await fetchHarveyTaskCriteria("task-slug-1");
    expect(result).toEqual(["Valid criterion", "Another valid one"]);
  });

  test("constructs the correct fetch URL from slug and base URL", async () => {
    process.env.HARVEY_LAB_TASKS_BASE_URL = "https://raw.example.com/repo";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ criteria: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchHarveyTaskCriteria("contract-review-v2");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.example.com/repo/tasks/contract-review-v2/task.json",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ensureHarveyLabEvalNodes
// ═══════════════════════════════════════════════════════════════════════════

describe("ensureHarveyLabEvalNodes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns evalSetRef and requirementRef on success", async () => {
    mockAddNode
      .mockResolvedValueOnce(nodeSuccess("evalset-ref-1"))   // EvalSet
      .mockResolvedValueOnce(nodeSuccess("req-ref-1"));       // EvalRequirement
    mockAddEdge.mockResolvedValue({ success: true });

    const result = await ensureHarveyLabEvalNodes(
      JARVIS_CONFIG,
      "contract-drafting",
      "Contract Drafting Task",
      ["Criterion A", "Criterion B"],
    );

    expect(result).toEqual({ evalSetRef: "evalset-ref-1", requirementRef: "req-ref-1" });
  });

  test("treats alreadyExists as success and returns refs", async () => {
    mockAddNode
      .mockResolvedValueOnce(nodeAlreadyExists("evalset-ref-existing"))
      .mockResolvedValueOnce(nodeAlreadyExists("req-ref-existing"));
    mockAddEdge.mockResolvedValue({ success: true });

    const result = await ensureHarveyLabEvalNodes(
      JARVIS_CONFIG,
      "review-nda",
      "Review NDA",
      [],
    );

    expect(result).toEqual({ evalSetRef: "evalset-ref-existing", requirementRef: "req-ref-existing" });
  });

  test("returns null when EvalSet addNode fails", async () => {
    mockAddNode.mockResolvedValueOnce(nodeFailure("EvalSet upsert failed"));

    const result = await ensureHarveyLabEvalNodes(
      JARVIS_CONFIG,
      "task-slug",
      "Task Title",
      [],
    );

    expect(result).toBeNull();
    // Should not attempt EvalRequirement or edge after EvalSet failure
    expect(mockAddNode).toHaveBeenCalledTimes(1);
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  test("returns null when EvalSet addNode returns success=false with no ref_id", async () => {
    mockAddNode.mockResolvedValueOnce({ success: true, ref_id: undefined });

    const result = await ensureHarveyLabEvalNodes(
      JARVIS_CONFIG,
      "task-slug",
      "Task Title",
      [],
    );

    expect(result).toBeNull();
  });

  test("returns null when EvalRequirement addNode fails", async () => {
    mockAddNode
      .mockResolvedValueOnce(nodeSuccess("evalset-ref-1"))
      .mockResolvedValueOnce(nodeFailure("EvalRequirement upsert failed"));

    const result = await ensureHarveyLabEvalNodes(
      JARVIS_CONFIG,
      "task-slug",
      "Task Title",
      ["criterion"],
    );

    expect(result).toBeNull();
    expect(mockAddEdge).not.toHaveBeenCalled();
  });

  test("returns null when addNode throws unexpectedly", async () => {
    mockAddNode.mockRejectedValueOnce(new Error("network timeout"));

    const result = await ensureHarveyLabEvalNodes(
      JARVIS_CONFIG,
      "task-slug",
      "Task Title",
      [],
    );

    expect(result).toBeNull();
  });

  test("passes correct node_data shapes to addNode", async () => {
    mockAddNode
      .mockResolvedValueOnce(nodeSuccess("evalset-ref-1"))
      .mockResolvedValueOnce(nodeSuccess("req-ref-1"));
    mockAddEdge.mockResolvedValue({ success: true });

    await ensureHarveyLabEvalNodes(
      JARVIS_CONFIG,
      "due-diligence",
      "Due Diligence Review",
      ["Find all liabilities", "Identify governing law"],
    );

    expect(mockAddNode).toHaveBeenNthCalledWith(1, JARVIS_CONFIG, {
      node_type: "EvalSet",
      node_data: {
        id: "harvey-lab",
        name: "Harvey LAB",
        description: "Harvey LAB benchmark evaluation set",
      },
    });

    expect(mockAddNode).toHaveBeenNthCalledWith(2, JARVIS_CONFIG, {
      node_type: "EvalRequirement",
      node_data: {
        id: "due-diligence",
        name: "Due Diligence Review",
        desirable_cases: ["Find all liabilities", "Identify governing law"],
        undesirable_cases: [],
      },
    });
  });

  test("wires HAS_REQUIREMENT edge between evalSet and requirement", async () => {
    mockAddNode
      .mockResolvedValueOnce(nodeSuccess("evalset-ref-1"))
      .mockResolvedValueOnce(nodeSuccess("req-ref-1"));
    mockAddEdge.mockResolvedValue({ success: true });

    await ensureHarveyLabEvalNodes(JARVIS_CONFIG, "task-slug", "Task Title", []);

    expect(mockAddEdge).toHaveBeenCalledWith(JARVIS_CONFIG, {
      edge: { edge_type: "HAS_REQUIREMENT" },
      source: { ref_id: "evalset-ref-1" },
      target: { ref_id: "req-ref-1" },
    });
  });
});
