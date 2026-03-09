import { describe, it, expect } from "vitest";
import { computeWorkflowDiff } from "@/lib/utils/workflow-diff";

function makeJson(transitions: Record<string, unknown>, connections: unknown[] = []): string {
  return JSON.stringify({ transitions, connections });
}

describe("computeWorkflowDiff", () => {
  describe("null / unparseable inputs", () => {
    it("returns empty sets when both inputs are null", () => {
      const result = computeWorkflowDiff(null, null);
      expect(result.changedStepIds.size).toBe(0);
      expect(result.changedConnectionIds.size).toBe(0);
    });

    it("returns empty sets when original is null", () => {
      const result = computeWorkflowDiff(null, makeJson({ stepA: { name: "A" } }));
      expect(result.changedStepIds.size).toBe(0);
    });

    it("returns empty sets when updated is null", () => {
      const result = computeWorkflowDiff(makeJson({ stepA: { name: "A" } }), null);
      expect(result.changedStepIds.size).toBe(0);
    });

    it("returns empty sets and does not throw on invalid JSON", () => {
      expect(() => computeWorkflowDiff("not-json", "also-not-json")).not.toThrow();
      const result = computeWorkflowDiff("not-json", "also-not-json");
      expect(result.changedStepIds.size).toBe(0);
      expect(result.changedConnectionIds.size).toBe(0);
    });
  });

  describe("step diffs (transitions)", () => {
    it("detects a step added in updated", () => {
      const original = makeJson({ stepA: { name: "A" } });
      const updated = makeJson({ stepA: { name: "A" }, stepB: { name: "B" } });
      const { changedStepIds } = computeWorkflowDiff(original, updated);
      expect(changedStepIds.has("stepB")).toBe(true);
      expect(changedStepIds.has("stepA")).toBe(false);
    });

    it("detects a step removed from original", () => {
      const original = makeJson({ stepA: { name: "A" }, stepB: { name: "B" } });
      const updated = makeJson({ stepA: { name: "A" } });
      const { changedStepIds } = computeWorkflowDiff(original, updated);
      expect(changedStepIds.has("stepB")).toBe(true);
      expect(changedStepIds.has("stepA")).toBe(false);
    });

    it("detects a step modified (same key, different value)", () => {
      const original = makeJson({ stepA: { name: "A", timeout: 10 } });
      const updated = makeJson({ stepA: { name: "A", timeout: 20 } });
      const { changedStepIds } = computeWorkflowDiff(original, updated);
      expect(changedStepIds.has("stepA")).toBe(true);
    });

    it("does NOT flag an unchanged step", () => {
      const original = makeJson({ stepA: { name: "A" }, stepB: { name: "B" } });
      const updated = makeJson({ stepA: { name: "A" }, stepB: { name: "B" } });
      const { changedStepIds } = computeWorkflowDiff(original, updated);
      expect(changedStepIds.size).toBe(0);
    });

    it("handles missing transitions key gracefully", () => {
      const original = JSON.stringify({ connections: [] });
      const updated = JSON.stringify({ connections: [] });
      const { changedStepIds } = computeWorkflowDiff(original, updated);
      expect(changedStepIds.size).toBe(0);
    });

    it("does NOT flag a step when only position has changed", () => {
      const original = makeJson({ stepA: { name: "A", timeout: 10, position: { x: 0, y: 0 } } });
      const updated = makeJson({ stepA: { name: "A", timeout: 10, position: { x: 100, y: 200 } } });
      const { changedStepIds } = computeWorkflowDiff(original, updated);
      expect(changedStepIds.size).toBe(0);
    });

    it("flags a step when position AND another field have changed", () => {
      const original = makeJson({ stepA: { name: "A", timeout: 10, position: { x: 0, y: 0 } } });
      const updated = makeJson({ stepA: { name: "A", timeout: 20, position: { x: 100, y: 200 } } });
      const { changedStepIds } = computeWorkflowDiff(original, updated);
      expect(changedStepIds.has("stepA")).toBe(true);
    });

    it("includes step.id from value in changedStepIds when key differs from step.id", () => {
      const original = makeJson({ stepAlias: { id: "stepAliasId", name: "A", timeout: 10 } });
      const updated = makeJson({ stepAlias: { id: "stepAliasId", name: "A", timeout: 20 } });
      const { changedStepIds } = computeWorkflowDiff(original, updated);
      expect(changedStepIds.has("stepAlias")).toBe(true);
      expect(changedStepIds.has("stepAliasId")).toBe(true);
    });
  });

  describe("connection diffs", () => {
    it("detects a connection added in updated", () => {
      const conn = { source: "stepA", target: "stepB" };
      const original = makeJson({}, []);
      const updated = makeJson({}, [conn]);
      const { changedConnectionIds } = computeWorkflowDiff(original, updated);
      expect(changedConnectionIds.has("stepA-stepB")).toBe(true);
    });

    it("detects a connection removed from original", () => {
      const conn = { source: "stepA", target: "stepB" };
      const original = makeJson({}, [conn]);
      const updated = makeJson({}, []);
      const { changedConnectionIds } = computeWorkflowDiff(original, updated);
      expect(changedConnectionIds.has("stepA-stepB")).toBe(true);
    });

    it("detects a connection modified (same key, different value)", () => {
      const original = makeJson({}, [{ source: "stepA", target: "stepB", label: "yes" }]);
      const updated = makeJson({}, [{ source: "stepA", target: "stepB", label: "no" }]);
      const { changedConnectionIds } = computeWorkflowDiff(original, updated);
      expect(changedConnectionIds.has("stepA-stepB")).toBe(true);
    });

    it("does NOT flag an unchanged connection", () => {
      const conn = { source: "stepA", target: "stepB" };
      const original = makeJson({}, [conn]);
      const updated = makeJson({}, [conn]);
      const { changedConnectionIds } = computeWorkflowDiff(original, updated);
      expect(changedConnectionIds.size).toBe(0);
    });

    it("handles missing connections key gracefully", () => {
      const original = JSON.stringify({ transitions: {} });
      const updated = JSON.stringify({ transitions: {} });
      const { changedConnectionIds } = computeWorkflowDiff(original, updated);
      expect(changedConnectionIds.size).toBe(0);
    });
  });

  describe("double-encoded JSON handling", () => {
    it("unwraps double-encoded JSON strings", () => {
      const inner = makeJson({ stepA: { name: "A" } });
      // Simulate double encoding: wrap in quotes
      const doubleEncoded = JSON.stringify(inner);
      const { changedStepIds } = computeWorkflowDiff(doubleEncoded, doubleEncoded);
      expect(changedStepIds.size).toBe(0);
    });
  });
});
