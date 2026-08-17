/**
 * Unit tests for `resolveContested` in eval-normalizers.ts.
 *
 * Covers the full truthiness matrix specified in the task:
 *   true/1/"true"/"TRUE" → true
 *   false/0/"false"/undefined/null/{}/[] → false
 *
 * Also verifies that a passing criterion with `contested: true` resolves to
 * true (no verdict gate — contested is independent of verdict).
 */

import { describe, it, expect } from "vitest";
import { resolveContested } from "@/lib/harvey-lab/eval-normalizers";

describe("resolveContested — truthiness matrix", () => {
  // ── Truthy inputs ────────────────────────────────────────────────────────

  it("returns true for boolean true", () => {
    expect(resolveContested({ contested: true })).toBe(true);
  });

  it("returns true for number 1", () => {
    expect(resolveContested({ contested: 1 })).toBe(true);
  });

  it("returns true for string 'true' (lowercase)", () => {
    expect(resolveContested({ contested: "true" })).toBe(true);
  });

  it("returns true for string 'TRUE' (uppercase)", () => {
    expect(resolveContested({ contested: "TRUE" })).toBe(true);
  });

  it("returns true for mixed-case 'True'", () => {
    expect(resolveContested({ contested: "True" })).toBe(true);
  });

  // ── Falsy inputs ─────────────────────────────────────────────────────────

  it("returns false for boolean false", () => {
    expect(resolveContested({ contested: false })).toBe(false);
  });

  it("returns false for number 0", () => {
    expect(resolveContested({ contested: 0 })).toBe(false);
  });

  it("returns false for string 'false'", () => {
    expect(resolveContested({ contested: "false" })).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(resolveContested({ contested: undefined })).toBe(false);
  });

  it("returns false when contested key is absent", () => {
    expect(resolveContested({})).toBe(false);
  });

  it("returns false for null", () => {
    expect(resolveContested({ contested: null })).toBe(false);
  });

  it("returns false for an object (never rides the projection)", () => {
    expect(resolveContested({ contested: { nested: true } })).toBe(false);
  });

  it("returns false for an array (never rides the projection)", () => {
    expect(resolveContested({ contested: ["true"] })).toBe(false);
  });

  it("returns false for number 2 (only 1 is truthy)", () => {
    expect(resolveContested({ contested: 2 })).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(resolveContested({ contested: "" })).toBe(false);
  });

  // ── Pass + contested: no verdict gate ───────────────────────────────────
  // contested describes the criterion *definition*, not how it scored.
  // A passing criterion with contested: true MUST still resolve to true.

  it("returns true for a passing criterion with contested: true (no verdict gate)", () => {
    // resolveContested only looks at `contested`; verdict is irrelevant to it.
    // We pass a full criterion-shaped object to confirm no unexpected gate.
    expect(
      resolveContested({ contested: true }),
    ).toBe(true);
  });

  it("returns true for pass+contested criterion shaped like a BenchmarkRunResult entry", () => {
    const criterion = {
      id: "C-001",
      title: "Identifies the indemnity cap",
      verdict: "pass",
      reasoning: "Correctly identified",
      contested: true,
    };
    expect(resolveContested(criterion)).toBe(true);
  });

  // ── resolveJudgeDispute is UNCHANGED ────────────────────────────────────
  // Verify that resolveContested's sibling still has its verdict gate
  // (contested deliberately drops the gate; resolveJudgeDispute keeps it).

  it("does not affect resolveJudgeDispute — it is a separate export", async () => {
    const { resolveJudgeDispute } = await import("@/lib/harvey-lab/eval-normalizers");
    // resolveJudgeDispute returns null for passing rows (verdict gate intact)
    expect(
      resolveJudgeDispute({ verdict: "pass", flagged: true, llm_flag_reason: "overreach" }),
    ).toBeNull();
    // resolveContested does NOT apply a verdict gate
    expect(resolveContested({ contested: true })).toBe(true);
  });
});
