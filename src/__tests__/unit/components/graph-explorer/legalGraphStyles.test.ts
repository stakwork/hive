import { describe, test, expect } from "vitest";
import {
  classifyOutputNodeType,
  LEGAL_NODE_COLORS,
  LEGAL_NODE_ICONS,
  LEGAL_EDGE_STYLES,
  LEGAL_NODE_TYPE_CANONICAL,
  resolveEdgeStyle,
} from "@/components/graph-explorer/legalGraphStyles";

// ── classifyOutputNodeType ───────────────────────────────────────────────────

describe("classifyOutputNodeType", () => {
  test("eval_status='accepted' → EvalTriggerOutput_pass", () => {
    expect(classifyOutputNodeType({ eval_status: "accepted", n_passed: 8, n_total: 8 })).toBe(
      "EvalTriggerOutput_pass"
    );
  });

  test("eval_status='rejected' → EvalTriggerOutput_fail", () => {
    expect(classifyOutputNodeType({ eval_status: "rejected", n_passed: 2, n_total: 8 })).toBe(
      "EvalTriggerOutput_fail"
    );
  });

  test("no eval_status + n_passed < n_total → EvalTriggerOutput_partial", () => {
    expect(classifyOutputNodeType({ n_passed: 5, n_total: 8 })).toBe(
      "EvalTriggerOutput_partial"
    );
  });

  test("no eval_status + n_passed === n_total → EvalTriggerOutput_pass", () => {
    expect(classifyOutputNodeType({ n_passed: 8, n_total: 8 })).toBe(
      "EvalTriggerOutput_pass"
    );
  });

  test("no eval_status + no n_passed/n_total → EvalTriggerOutput_partial", () => {
    expect(classifyOutputNodeType({})).toBe("EvalTriggerOutput_partial");
  });

  test("no eval_status + n_total = 0 → EvalTriggerOutput_partial (no division by zero)", () => {
    expect(classifyOutputNodeType({ n_passed: 0, n_total: 0 })).toBe("EvalTriggerOutput_partial");
  });

  test("eval_status takes priority over n_passed/n_total ratio", () => {
    // n_passed/n_total would indicate partial, but eval_status wins
    expect(classifyOutputNodeType({ eval_status: "accepted", n_passed: 3, n_total: 8 })).toBe(
      "EvalTriggerOutput_pass"
    );
    expect(classifyOutputNodeType({ eval_status: "rejected", n_passed: 8, n_total: 8 })).toBe(
      "EvalTriggerOutput_fail"
    );
  });

  test("numeric string n_passed/n_total (coerced) → correct branch", () => {
    expect(classifyOutputNodeType({ n_passed: "8", n_total: "8" })).toBe(
      "EvalTriggerOutput_pass"
    );
    expect(classifyOutputNodeType({ n_passed: "5", n_total: "8" })).toBe(
      "EvalTriggerOutput_partial"
    );
  });
});

// ── LEGAL_NODE_COLORS ────────────────────────────────────────────────────────

describe("LEGAL_NODE_COLORS", () => {
  test("has expected PascalCase keys with correct hex values", () => {
    expect(LEGAL_NODE_COLORS.EvalSet).toBe("#3b82f6");
    expect(LEGAL_NODE_COLORS.BaselineTrigger).toBe("#6b7280");
    expect(LEGAL_NODE_COLORS.EvalTrigger).toBe("#14b8a6");
    expect(LEGAL_NODE_COLORS.EvalTriggerOutput_pass).toBe("#22c55e");
    expect(LEGAL_NODE_COLORS.EvalTriggerOutput_fail).toBe("#ef4444");
    expect(LEGAL_NODE_COLORS.EvalTriggerOutput_partial).toBe("#f59e0b");
    expect(LEGAL_NODE_COLORS.ProposedFix).toBe("#a855f7");
    expect(LEGAL_NODE_COLORS.EvalRequirement).toBe("#6366f1");
  });

  test("keys are all PascalCase (no lowercase)", () => {
    for (const key of Object.keys(LEGAL_NODE_COLORS)) {
      expect(key.charAt(0)).toMatch(/[A-Z]/);
    }
  });
});

// ── LEGAL_NODE_ICONS ─────────────────────────────────────────────────────────

describe("LEGAL_NODE_ICONS", () => {
  test("has an icon for every key in LEGAL_NODE_COLORS", () => {
    for (const key of Object.keys(LEGAL_NODE_COLORS)) {
      expect(LEGAL_NODE_ICONS[key]).toBeDefined();
      expect(LEGAL_NODE_ICONS[key].length).toBeGreaterThan(0);
    }
  });
});

// ── LEGAL_EDGE_STYLES ────────────────────────────────────────────────────────

describe("LEGAL_EDGE_STYLES", () => {
  test("HAS_TRIGGER is solid (no strokeDasharray)", () => {
    const s = LEGAL_EDGE_STYLES.HAS_TRIGGER;
    expect(s.stroke).toBeTruthy();
    expect(s.strokeDasharray).toBeUndefined();
  });

  test("HAS_BASELINE_TRIGGER is solid (no strokeDasharray)", () => {
    const s = LEGAL_EDGE_STYLES.HAS_BASELINE_TRIGGER;
    expect(s.stroke).toBeTruthy();
    expect(s.strokeDasharray).toBeUndefined();
  });

  test("HAS_PROPOSED_FIX is dashed", () => {
    const s = LEGAL_EDGE_STYLES.HAS_PROPOSED_FIX;
    expect(s.strokeDasharray).toBeTruthy();
    expect(s.stroke).toBe("#a855f7");
  });

  test("DERIVED_FROM is dotted", () => {
    const s = LEGAL_EDGE_STYLES.DERIVED_FROM;
    expect(s.strokeDasharray).toBeTruthy();
    expect(s.stroke).toBe("#9ca3af");
  });

  test("HAS_REQUIREMENT has strokeWidth", () => {
    const s = LEGAL_EDGE_STYLES.HAS_REQUIREMENT;
    expect(s.strokeWidth).toBeDefined();
    expect(s.stroke).toBe("#6366f1");
  });
});

// ── LEGAL_NODE_TYPE_CANONICAL ────────────────────────────────────────────────

describe("LEGAL_NODE_TYPE_CANONICAL", () => {
  test("normalises 'evalset' → 'EvalSet'", () => {
    expect(LEGAL_NODE_TYPE_CANONICAL["evalset"]).toBe("EvalSet");
  });

  test("normalises 'evaltrigger' → 'EvalTrigger'", () => {
    expect(LEGAL_NODE_TYPE_CANONICAL["evaltrigger"]).toBe("EvalTrigger");
  });

  test("normalises 'evaltriggeroutput' → 'EvalTriggerOutput'", () => {
    expect(LEGAL_NODE_TYPE_CANONICAL["evaltriggeroutput"]).toBe("EvalTriggerOutput");
  });

  test("normalises 'proposedfix' → 'ProposedFix'", () => {
    expect(LEGAL_NODE_TYPE_CANONICAL["proposedfix"]).toBe("ProposedFix");
  });

  test("normalises 'evalrequirement' → 'EvalRequirement'", () => {
    expect(LEGAL_NODE_TYPE_CANONICAL["evalrequirement"]).toBe("EvalRequirement");
  });

  test("normalises 'baselinetrigger' → 'BaselineTrigger'", () => {
    expect(LEGAL_NODE_TYPE_CANONICAL["baselinetrigger"]).toBe("BaselineTrigger");
  });

  test("keys are all lowercase", () => {
    for (const key of Object.keys(LEGAL_NODE_TYPE_CANONICAL)) {
      expect(key).toBe(key.toLowerCase());
    }
  });
});

// ── resolveEdgeStyle ─────────────────────────────────────────────────────────

describe("resolveEdgeStyle", () => {
  test("HAS_PROPOSED_FIX returns dashed stroke", () => {
    const s = resolveEdgeStyle("HAS_PROPOSED_FIX");
    expect(s).toBeDefined();
    expect(s!.strokeDasharray).toBeTruthy();
  });

  test("HAS_OUTPUT resolves stroke from sourceType (EvalTrigger)", () => {
    const s = resolveEdgeStyle("HAS_OUTPUT", "EvalTrigger");
    expect(s).toBeDefined();
    expect(s!.stroke).toBe(LEGAL_NODE_COLORS.EvalTrigger);
  });

  test("HAS_OUTPUT without sourceType falls back to gray", () => {
    const s = resolveEdgeStyle("HAS_OUTPUT");
    expect(s).toBeDefined();
    expect(s!.stroke).toBe("#6b7280");
  });

  test("HAS_OUTPUT with unknown sourceType falls back to gray", () => {
    const s = resolveEdgeStyle("HAS_OUTPUT", "UnknownType");
    expect(s!.stroke).toBe("#6b7280");
  });

  test("HAS_TRIGGER returns solid (no strokeDasharray)", () => {
    const s = resolveEdgeStyle("HAS_TRIGGER");
    expect(s!.strokeDasharray).toBeUndefined();
  });

  test("DERIVED_FROM returns dotted stroke", () => {
    const s = resolveEdgeStyle("DERIVED_FROM");
    expect(s!.strokeDasharray).toBeTruthy();
  });

  test("unknown edge type returns undefined", () => {
    expect(resolveEdgeStyle("UNKNOWN_EDGE")).toBeUndefined();
  });
});
