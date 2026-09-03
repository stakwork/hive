/**
 * Unit tests for legal-benchmark-recursion-summary.ts
 *
 * Contract under test:
 *   fetchRecursionTaskSummary(config, entries) → RecursionSummaryEntry[]
 *
 * Coverage:
 *   - Per-task failure isolation (one task failing must not zero adjacent tasks)
 *   - Failure path reached via explicit return-value checks (not allSettled rejections)
 *   - rubricCount/contestedCount derived correctly from rubric array
 *   - Wave 2 trigger selection uses Wave 1 results; sorted by date_added_to_graph desc; absent-field nodes sort last
 *   - isDefault: true set correctly on degraded tasks
 *   - No logger.warn/logger.error call includes api key or swarmApiKey
 *   - name/reason/recursion passed through directly from entry
 *   - fixChainDepth counts only EvalTrigger-typed neighbors
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock fetchEvalSetRubrics ────────────────────────────────────────────────
const mockFetchEvalSetRubrics = vi.hoisted(() => vi.fn());
vi.mock("@/services/legal-benchmark-rubrics", () => ({
  fetchEvalSetRubrics: mockFetchEvalSetRubrics,
}));

// ── Mock expandEdges ────────────────────────────────────────────────────────
const mockExpandEdges = vi.hoisted(() => vi.fn());
vi.mock("@/lib/harvey-lab/jarvis-expand", () => ({
  expandEdges: mockExpandEdges,
}));

// ── Mock logger ────────────────────────────────────────────────────────────
const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({
  logger: {
    warn: mockLoggerWarn,
    error: mockLoggerError,
    info: vi.fn(),
  },
}));

import {
  fetchRecursionTaskSummary,
  type RecursionSummaryEntry,
} from "@/services/legal-benchmark-recursion-summary";
import type { RecursionEvalSetEntry } from "@/services/legal-benchmark-recursion";
import type { JarvisConnectionConfig } from "@/types/jarvis";

const CONFIG: JarvisConnectionConfig = {
  jarvisUrl: "https://jarvis.example.com",
  apiKey: "super-secret-api-key-xyz",
};

function makeEntry(overrides: Partial<RecursionEvalSetEntry> = {}): RecursionEvalSetEntry {
  return {
    ref_id: "evalset-ref-1",
    id: "task-slug-1",
    name: "Task 1",
    reason: "active",
    recursion: true,
    ...overrides,
  };
}

function makeRubric(contested = false) {
  return {
    ref_id: `rubric-${Math.random()}`,
    id: `crit-${Math.random()}`,
    name: "Some criterion",
    contested,
  };
}

function makeTriggerNode(dateAdded?: string): Record<string, unknown> {
  return {
    ref_id: `trigger-${Math.random().toString(36).slice(2)}`,
    node_type: "EvalTrigger",
    ...(dateAdded !== undefined ? { date_added_to_graph: dateAdded } : {}),
  };
}

function makeOutputNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref_id: `output-${Math.random().toString(36).slice(2)}`,
    node_type: "EvalTriggerOutput",
    properties: { n_passed: 7, n_total: 10 },
    date_added_to_graph: "1700000000",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchRecursionTaskSummary", () => {
  describe("passthrough fields", () => {
    it("passes name, reason, and recursion directly from entry without extra Jarvis calls", async () => {
      const entry = makeEntry({
        name: "My Task",
        reason: "wasEnabled",
        recursion: false,
      });
      mockFetchEvalSetRubrics.mockResolvedValue({ ok: true, rubrics: [] });
      mockExpandEdges.mockResolvedValue([]); // no triggers

      const [result] = await fetchRecursionTaskSummary(CONFIG, [entry]);

      expect(result.name).toBe("My Task");
      expect(result.reason).toBe("wasEnabled");
      expect(result.recursion).toBe(false);
      expect(result.taskSlug).toBe("task-slug-1");
      expect(result.refId).toBe("evalset-ref-1");
    });
  });

  describe("rubric counting", () => {
    it("derives rubricCount and contestedCount correctly from rubric array", async () => {
      const entry = makeEntry();
      const rubrics = [
        makeRubric(false),
        makeRubric(false),
        makeRubric(true),  // contested
        makeRubric(true),  // contested
        makeRubric(false),
      ];
      mockFetchEvalSetRubrics.mockResolvedValue({ ok: true, rubrics });
      mockExpandEdges.mockResolvedValue([]); // no triggers

      const [result] = await fetchRecursionTaskSummary(CONFIG, [entry]);

      expect(result.rubricCount).toBe(5);
      expect(result.contestedCount).toBe(2);
      expect(result.isDefault).toBe(false);
    });

    it("handles empty rubric array (rubricCount=0, contestedCount=0)", async () => {
      const entry = makeEntry();
      mockFetchEvalSetRubrics.mockResolvedValue({ ok: true, rubrics: [] });
      mockExpandEdges.mockResolvedValue([]);

      const [result] = await fetchRecursionTaskSummary(CONFIG, [entry]);

      expect(result.rubricCount).toBe(0);
      expect(result.contestedCount).toBe(0);
      expect(result.isDefault).toBe(false);
    });
  });

  describe("fixChainDepth", () => {
    it("counts only EvalTrigger-typed neighbors", async () => {
      const entry = makeEntry();
      mockFetchEvalSetRubrics.mockResolvedValue({ ok: true, rubrics: [] });
      // Mix of EvalTrigger and other node types
      mockExpandEdges.mockImplementation(async (refId: string, edgeTypes: string[]) => {
        if (edgeTypes.includes("HAS_BASELINE_TRIGGER")) {
          return [
            { ref_id: "trig-1", node_type: "EvalTrigger", date_added_to_graph: "1700000001" },
            { ref_id: "not-a-trigger", node_type: "Concept" },
            { ref_id: "trig-2", node_type: "EvalTrigger", date_added_to_graph: "1700000002" },
          ];
        }
        // Wave 2: HAS_OUTPUT expand
        return [makeOutputNode()];
      });

      const [result] = await fetchRecursionTaskSummary(CONFIG, [entry]);

      // Only EvalTrigger nodes count toward fixChainDepth
      expect(result.fixChainDepth).toBe(2);
    });
  });

  describe("Wave 2 trigger selection", () => {
    it("sorts triggers by date_added_to_graph desc and picks the most recent", async () => {
      const entry = makeEntry();
      const trigger1 = { ref_id: "trig-old", node_type: "EvalTrigger", date_added_to_graph: "1600000000" };
      const trigger2 = { ref_id: "trig-newest", node_type: "EvalTrigger", date_added_to_graph: "1700000999" };
      const trigger3 = { ref_id: "trig-mid", node_type: "EvalTrigger", date_added_to_graph: "1700000100" };

      mockFetchEvalSetRubrics.mockResolvedValue({ ok: true, rubrics: [] });

      const wave2Calls: string[] = [];
      mockExpandEdges.mockImplementation(async (refId: string, edgeTypes: string[]) => {
        if (edgeTypes.includes("HAS_BASELINE_TRIGGER")) {
          // Return in non-sorted order — Wave 2 must sort
          return [trigger1, trigger3, trigger2];
        }
        // Wave 2 call — record which trigger was picked
        wave2Calls.push(refId);
        return [makeOutputNode({ properties: { n_passed: 8, n_total: 10 } })];
      });

      await fetchRecursionTaskSummary(CONFIG, [entry]);

      // The most recent trigger (trig-newest) should be expanded in Wave 2
      expect(wave2Calls).toHaveLength(1);
      expect(wave2Calls[0]).toBe("trig-newest");
    });

    it("nodes without date_added_to_graph sort last", async () => {
      const entry = makeEntry();
      const triggerWithDate = {
        ref_id: "trig-with-date",
        node_type: "EvalTrigger",
        date_added_to_graph: "1700000000",
      };
      const triggerNoDate = {
        ref_id: "trig-no-date",
        node_type: "EvalTrigger",
        // date_added_to_graph absent
      };

      mockFetchEvalSetRubrics.mockResolvedValue({ ok: true, rubrics: [] });

      const wave2Calls: string[] = [];
      mockExpandEdges.mockImplementation(async (refId: string, edgeTypes: string[]) => {
        if (edgeTypes.includes("HAS_BASELINE_TRIGGER")) {
          return [triggerNoDate, triggerWithDate]; // no-date first in source, should sort last
        }
        wave2Calls.push(refId);
        return [makeOutputNode()];
      });

      await fetchRecursionTaskSummary(CONFIG, [entry]);

      // triggerWithDate should be picked (the one with a date sorts first / highest)
      expect(wave2Calls[0]).toBe("trig-with-date");
    });

    it("skips Wave 2 when Wave 1 returns no trigger neighbors", async () => {
      const entry = makeEntry();
      mockFetchEvalSetRubrics.mockResolvedValue({ ok: true, rubrics: [] });
      // Wave 1 returns no triggers
      mockExpandEdges.mockResolvedValue([]);

      const [result] = await fetchRecursionTaskSummary(CONFIG, [entry]);

      // expandEdges should only have been called once (Wave 1 triggers expand)
      expect(mockExpandEdges).toHaveBeenCalledTimes(1);
      expect(result.latestRun).toBeNull();
      expect(result.fixChainDepth).toBe(0);
      expect(result.isDefault).toBe(false);
    });

    it("extracts n_passed, n_total, and runAt from the output node", async () => {
      const entry = makeEntry();
      const trigger = makeTriggerNode("1700000001");
      const outputNode = makeOutputNode({
        ref_id: "output-1",
        node_type: "EvalTriggerOutput",
        properties: { n_passed: 6, n_total: 10 },
        date_added_to_graph: "1700000050",
      });

      mockFetchEvalSetRubrics.mockResolvedValue({ ok: true, rubrics: [] });
      mockExpandEdges.mockImplementation(async (_refId: string, edgeTypes: string[]) => {
        if (edgeTypes.includes("HAS_BASELINE_TRIGGER")) return [trigger];
        return [outputNode];
      });

      const [result] = await fetchRecursionTaskSummary(CONFIG, [entry]);

      expect(result.latestRun).toEqual({
        n_passed: 6,
        n_total: 10,
        runAt: "2023-11-14T22:14:10.000Z",
      });
    });
  });

  describe("per-task failure isolation", () => {
    it("one task with rubric failure does not zero adjacent tasks", async () => {
      const entry1 = makeEntry({ ref_id: "ref-1", id: "task-1", name: "Task 1" });
      const entry2 = makeEntry({ ref_id: "ref-2", id: "task-2", name: "Task 2" });

      const rubrics = [makeRubric(false), makeRubric(false), makeRubric(true)];

      mockFetchEvalSetRubrics.mockImplementation(async (_config: unknown, refId: string) => {
        if (refId === "ref-1") return { ok: false, error: "Jarvis timeout" }; // task-1 fails
        return { ok: true, rubrics }; // task-2 succeeds
      });

      mockExpandEdges.mockImplementation(async (refId: string) => {
        if (refId === "ref-1") return null; // task-1 triggers also fail
        return []; // task-2 has no triggers
      });

      const results = await fetchRecursionTaskSummary(CONFIG, [entry1, entry2]);

      expect(results).toHaveLength(2);

      const r1 = results.find((r) => r.taskSlug === "task-1")!;
      expect(r1.isDefault).toBe(true);
      expect(r1.rubricCount).toBe(0);
      expect(r1.fixChainDepth).toBe(0);

      const r2 = results.find((r) => r.taskSlug === "task-2")!;
      expect(r2.isDefault).toBe(false);
      expect(r2.rubricCount).toBe(3);
      expect(r2.contestedCount).toBe(1);
    });

    it("one task with expandEdges returning null does not zero adjacent tasks", async () => {
      const entry1 = makeEntry({ ref_id: "ref-1", id: "task-1" });
      const entry2 = makeEntry({ ref_id: "ref-2", id: "task-2" });

      mockFetchEvalSetRubrics.mockResolvedValue({ ok: true, rubrics: [makeRubric()] });
      mockExpandEdges.mockImplementation(async (refId: string) => {
        if (refId === "ref-1") return null; // fail for task-1
        return []; // empty but not null for task-2
      });

      const results = await fetchRecursionTaskSummary(CONFIG, [entry1, entry2]);

      expect(results).toHaveLength(2);
      const r1 = results.find((r) => r.taskSlug === "task-1")!;
      expect(r1.isDefault).toBe(true);

      const r2 = results.find((r) => r.taskSlug === "task-2")!;
      expect(r2.isDefault).toBe(false);
    });

    it("failure path triggered by explicit return-value checks, not rejection catches", async () => {
      // Both helpers return failure values (never throw).
      // Promise.allSettled always sees 'fulfilled' for these helpers —
      // the fallback must be triggered by .ok === false / === null.
      const entry = makeEntry();

      // fetchEvalSetRubrics returns { ok: false } — doesn't throw
      mockFetchEvalSetRubrics.mockResolvedValue({ ok: false, error: "Network error" });
      // expandEdges returns null — doesn't throw
      mockExpandEdges.mockResolvedValue(null);

      const [result] = await fetchRecursionTaskSummary(CONFIG, [entry]);

      expect(result.isDefault).toBe(true);
      // Verify the function completed without throwing
      expect(result.taskSlug).toBe("task-slug-1");
    });

    it("isDefault: false on a successful fetch", async () => {
      const entry = makeEntry();
      mockFetchEvalSetRubrics.mockResolvedValue({ ok: true, rubrics: [makeRubric()] });
      mockExpandEdges.mockResolvedValue([]);

      const [result] = await fetchRecursionTaskSummary(CONFIG, [entry]);

      expect(result.isDefault).toBe(false);
    });
  });

  describe("log discipline — no API key leakage", () => {
    it("logger.warn on per-task failure does not include apiKey or swarmApiKey", async () => {
      const entry = makeEntry();
      mockFetchEvalSetRubrics.mockResolvedValue({ ok: false, error: "fail" });
      mockExpandEdges.mockResolvedValue(null);

      await fetchRecursionTaskSummary(CONFIG, [entry]);

      for (const call of mockLoggerWarn.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toMatch(/api.?key|swarmApiKey/i);
        // Verify the actual secret value never appears
        expect(serialized).not.toContain("super-secret-api-key-xyz");
      }
      for (const call of mockLoggerError.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toMatch(/api.?key|swarmApiKey/i);
        expect(serialized).not.toContain("super-secret-api-key-xyz");
      }
    });
  });

  describe("empty entries array", () => {
    it("returns empty array when no entries are passed", async () => {
      const result = await fetchRecursionTaskSummary(CONFIG, []);
      expect(result).toEqual([]);
    });
  });

  describe("Wave 2 non-fatal failure", () => {
    it("latestRun is null when Wave 2 expandEdges returns null, other fields still valid", async () => {
      const entry = makeEntry();
      const trigger = makeTriggerNode("1700000001");

      mockFetchEvalSetRubrics.mockResolvedValue({ ok: true, rubrics: [makeRubric()] });
      mockExpandEdges.mockImplementation(async (_refId: string, edgeTypes: string[]) => {
        if (edgeTypes.includes("HAS_BASELINE_TRIGGER")) return [trigger];
        return null; // Wave 2 fails
      });

      const [result] = await fetchRecursionTaskSummary(CONFIG, [entry]);

      // Wave 2 failure is non-fatal — other fields still valid
      expect(result.isDefault).toBe(false);
      expect(result.rubricCount).toBe(1);
      expect(result.fixChainDepth).toBe(1);
      expect(result.latestRun).toBeNull();
    });
  });
});
