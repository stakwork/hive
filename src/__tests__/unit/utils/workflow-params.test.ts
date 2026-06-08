import { describe, it, expect } from "vitest";
import { extractSetVarParams, diffSetVarParams } from "@/lib/utils/workflow-params";

// ── helpers ────────────────────────────────────────────────────────────────────

function makeJson(transitions: unknown, connections: unknown[] = []): string {
  return JSON.stringify({ transitions, connections });
}

/**
 * Simulate "double-encoded" JSON as produced by graph API storage —
 * wraps in extra unescaped quotes (the pattern parseWorkflowJson handles:
 * starts/ends with `"`, slice(1,-1) reveals the inner JSON string).
 */
function doubleEncode(json: string): string {
  return '"' + json + '"';
}

// ── extractSetVarParams ────────────────────────────────────────────────────────

describe("extractSetVarParams", () => {
  it("returns {} for null input", () => {
    expect(extractSetVarParams(null)).toEqual({});
  });

  it("returns {} for malformed JSON", () => {
    expect(extractSetVarParams("not-json")).toEqual({});
  });

  it("returns {} for double-encoded JSON with no vars transitions", () => {
    const json = makeJson({ step1: { name: "NoVars" } });
    expect(extractSetVarParams(doubleEncode(json))).toEqual({});
  });

  it("returns {} when transitions have no vars-bearing steps", () => {
    const json = makeJson({
      step1: { name: "A", attributes: {} },
      step2: { name: "B" },
    });
    expect(extractSetVarParams(json)).toEqual({});
  });

  it("extracts vars from step.attributes.vars (object transition format)", () => {
    const json = makeJson({
      step1: {
        step: {
          attributes: {
            vars: { api_key: "secret", model: "gpt-4" },
          },
        },
      },
    });
    expect(extractSetVarParams(json)).toEqual({ api_key: "secret", model: "gpt-4" });
  });

  it("extracts vars from top-level attributes.vars", () => {
    const json = makeJson({
      step1: {
        attributes: {
          vars: { token: "abc123" },
        },
      },
    });
    expect(extractSetVarParams(json)).toEqual({ token: "abc123" });
  });

  it("merges vars from multiple transitions", () => {
    const json = makeJson({
      step1: { attributes: { vars: { key_a: "val_a" } } },
      step2: { attributes: { vars: { key_b: "val_b" } } },
    });
    expect(extractSetVarParams(json)).toEqual({ key_a: "val_a", key_b: "val_b" });
  });

  it("handles array-format transitions", () => {
    const json = makeJson([
      { id: "step1", attributes: { vars: { arr_key: "arr_val" } } },
      { id: "step2", name: "no vars" },
    ]);
    expect(extractSetVarParams(json)).toEqual({ arr_key: "arr_val" });
  });

  it("handles double-encoded JSON with vars", () => {
    const inner = makeJson({
      step1: { attributes: { vars: { encoded_key: "encoded_val" } } },
    });
    expect(extractSetVarParams(doubleEncode(inner))).toEqual({ encoded_key: "encoded_val" });
  });

  it("ignores empty vars objects", () => {
    const json = makeJson({
      step1: { attributes: { vars: {} } },
    });
    expect(extractSetVarParams(json)).toEqual({});
  });

  it("ignores vars that are arrays (not plain objects)", () => {
    const json = makeJson({
      step1: { attributes: { vars: ["a", "b"] } },
    });
    expect(extractSetVarParams(json)).toEqual({});
  });
});

// ── diffSetVarParams ───────────────────────────────────────────────────────────

describe("diffSetVarParams", () => {
  it("returns all-empty when both inputs are null", () => {
    expect(diffSetVarParams(null, null)).toEqual({ added: [], removed: [], modified: [] });
  });

  it("treats all keys as added when prevJson is null (first version)", () => {
    const next = makeJson({ step1: { attributes: { vars: { a: 1, b: 2 } } } });
    const result = diffSetVarParams(null, next);
    expect(result.added.sort()).toEqual(["a", "b"]);
    expect(result.removed).toEqual([]);
    expect(result.modified).toEqual([]);
  });

  it("detects added keys", () => {
    const prev = makeJson({ step1: { attributes: { vars: { a: 1 } } } });
    const next = makeJson({ step1: { attributes: { vars: { a: 1, b: 2 } } } });
    const result = diffSetVarParams(prev, next);
    expect(result.added).toEqual(["b"]);
    expect(result.removed).toEqual([]);
    expect(result.modified).toEqual([]);
  });

  it("detects removed keys", () => {
    const prev = makeJson({ step1: { attributes: { vars: { a: 1, b: 2 } } } });
    const next = makeJson({ step1: { attributes: { vars: { a: 1 } } } });
    const result = diffSetVarParams(prev, next);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual(["b"]);
    expect(result.modified).toEqual([]);
  });

  it("detects modified values", () => {
    const prev = makeJson({ step1: { attributes: { vars: { a: "old", b: 2 } } } });
    const next = makeJson({ step1: { attributes: { vars: { a: "new", b: 2 } } } });
    const result = diffSetVarParams(prev, next);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.modified).toEqual(["a"]);
  });

  it("returns all-empty when inputs are equivalent", () => {
    const json = makeJson({ step1: { attributes: { vars: { key: "val" } } } });
    expect(diffSetVarParams(json, json)).toEqual({ added: [], removed: [], modified: [] });
  });

  it("detects all three diff categories simultaneously", () => {
    const prev = makeJson({ step1: { attributes: { vars: { old_key: "x", shared: "same", to_change: 1 } } } });
    const next = makeJson({ step1: { attributes: { vars: { new_key: "y", shared: "same", to_change: 2 } } } });
    const result = diffSetVarParams(prev, next);
    expect(result.added).toEqual(["new_key"]);
    expect(result.removed).toEqual(["old_key"]);
    expect(result.modified).toEqual(["to_change"]);
  });

  it("handles object values in modified check (deep compare)", () => {
    const prev = makeJson({ step1: { attributes: { vars: { cfg: { x: 1 } } } } });
    const nextSame = makeJson({ step1: { attributes: { vars: { cfg: { x: 1 } } } } });
    const nextDiff = makeJson({ step1: { attributes: { vars: { cfg: { x: 2 } } } } });
    expect(diffSetVarParams(prev, nextSame).modified).toEqual([]);
    expect(diffSetVarParams(prev, nextDiff).modified).toEqual(["cfg"]);
  });
});
