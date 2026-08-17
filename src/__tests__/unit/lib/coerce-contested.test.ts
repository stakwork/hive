/**
 * Unit tests for coerceContested() — the boolean coercion helper for the
 * `contested` field on EvalRequirement write routes.
 */
import { describe, test, expect } from "vitest";
import { coerceContested } from "@/app/api/workspaces/[slug]/evals/[evalSetId]/requirements/route";

describe("coerceContested", () => {
  // ── Truthy values → true ─────────────────────────────────────────────────
  test.each([
    ["boolean true", true],
    ["number 1", 1],
    ['string "true"', "true"],
    ['string "TRUE"', "TRUE"],
    ['string "True"', "True"],
  ])("returns true for %s", (_label, value) => {
    expect(coerceContested(value)).toBe(true);
  });

  // ── Falsy values → false ─────────────────────────────────────────────────
  test.each([
    ["boolean false", false],
    ["number 0", 0],
    ['string "false"', "false"],
    ['string "FALSE"', "FALSE"],
    ['string "False"', "False"],
  ])("returns false for %s", (_label, value) => {
    expect(coerceContested(value)).toBe(false);
  });

  // ── Absent values → undefined ─────────────────────────────────────────────
  test("returns undefined for undefined", () => {
    expect(coerceContested(undefined)).toBeUndefined();
  });

  test("returns undefined for null", () => {
    expect(coerceContested(null)).toBeUndefined();
  });

  // ── Un-coercible values → null (caller should 400) ────────────────────────
  test.each([
    ['string "maybe"', "maybe"],
    ['string "1"', "1"],
    ['string "0"', "0"],
    ["empty string", ""],
    ["object {}", {}],
    ["array []", []],
    ["number 2", 2],
    ["number -1", -1],
  ])("returns null for un-coercible value %s", (_label, value) => {
    expect(coerceContested(value)).toBeNull();
  });
});
