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

  // ── resolveJudgeDispute contract (sibling function) ─────────────────────
  // Verify that resolveContested's sibling still has its verdict gate
  // (contested deliberately drops the gate; resolveJudgeDispute keeps it),
  // and now surfaces isDispute and flagBasis on its return.

  it("resolveJudgeDispute — verdict gate intact (pass → null)", async () => {
    const { resolveJudgeDispute } = await import("@/lib/harvey-lab/eval-normalizers");
    // resolveJudgeDispute returns null for passing rows (verdict gate intact)
    expect(
      resolveJudgeDispute({ verdict: "pass", flagged: true, llm_flag_reason: "overreach" }),
    ).toBeNull();
    // resolveContested does NOT apply a verdict gate
    expect(resolveContested({ contested: true })).toBe(true);
  });

  it("resolveJudgeDispute — returns isDispute:true when flagged is truthy", async () => {
    const { resolveJudgeDispute } = await import("@/lib/harvey-lab/eval-normalizers");
    const result = resolveJudgeDispute({ verdict: "fail", flagged: true });
    expect(result).not.toBeNull();
    expect(result!.isDispute).toBe(true);
  });

  it("resolveJudgeDispute — returns isDispute:false when only prose is present", async () => {
    const { resolveJudgeDispute } = await import("@/lib/harvey-lab/eval-normalizers");
    const result = resolveJudgeDispute({
      verdict: "fail",
      llm_flag_reason: "The criterion definition itself is ambiguous.",
    });
    expect(result).not.toBeNull();
    expect(result!.isDispute).toBe(false);
    expect(result!.flagBasis).toBeNull();
  });
});

// ─── resolveContestReason regression pin ─────────────────────────────────────
// These tests are the durable regression pin for DISPUTED vs CONTESTED separation.
// resolveContestReason MUST NOT read reasoning, llm_flag_reason, or judgeFlagReason.

import { resolveContestReason } from "@/lib/harvey-lab/eval-normalizers";

describe("resolveContestReason — regression pin (DISPUTED vs CONTESTED)", () => {
  it("returns null for object carrying 'reasoning' (judge pass/fail prose)", () => {
    expect(resolveContestReason({ reasoning: "Correctly identified all parties" })).toBeNull();
  });

  it("returns null for object carrying 'llm_flag_reason' (judge-dispute field)", () => {
    expect(resolveContestReason({ llm_flag_reason: "The criterion definition is disputed" })).toBeNull();
  });

  it("returns null for object carrying 'judgeFlagReason' (derive.ts mapped name)", () => {
    expect(resolveContestReason({ judgeFlagReason: "Contested verdict argument" })).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(resolveContestReason({})).toBeNull();
  });

  it("returns null when contestReason is null", () => {
    expect(resolveContestReason({ contestReason: null })).toBeNull();
  });

  it("returns null when contestReason is empty string", () => {
    expect(resolveContestReason({ contestReason: "   " })).toBeNull();
  });

  it("returns trimmed string when contestReason is present", () => {
    expect(resolveContestReason({ contestReason: "  Scope is ambiguous  " })).toBe("Scope is ambiguous");
  });

  it("contestReason takes precedence — llm_flag_reason on same object does NOT bleed through", () => {
    // If both fields are present, only contestReason is read.
    const result = resolveContestReason({
      contestReason: "Contest argument",
      llm_flag_reason: "Judge dispute prose",
    });
    expect(result).toBe("Contest argument");
  });
});
