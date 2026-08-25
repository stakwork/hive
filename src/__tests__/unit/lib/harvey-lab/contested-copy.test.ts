import { describe, it, expect } from "vitest";
import { contestedNotice } from "@/lib/harvey-lab/contested-copy";
import type { ContestedOriginToken } from "@/lib/harvey-lab/rubric-scoring";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ALL_ORIGINS: ContestedOriginToken[] = ["in-run", "both", "roster", "unknown"];

// ─── Label tests ──────────────────────────────────────────────────────────────

describe("contestedNotice — labels", () => {
  it("'in-run' → label 'CONTESTED'", () => {
    expect(contestedNotice({ origin: "in-run" }).label).toBe("CONTESTED");
  });

  it("'both' → label 'CONTESTED'", () => {
    expect(contestedNotice({ origin: "both" }).label).toBe("CONTESTED");
  });

  it("'roster' → label 'PRIOR CONTEST'", () => {
    expect(contestedNotice({ origin: "roster" }).label).toBe("PRIOR CONTEST");
  });

  it("'unknown' → label 'CONTESTED'", () => {
    expect(contestedNotice({ origin: "unknown" }).label).toBe("CONTESTED");
  });
});

// ─── Every tooltip must contain "contested" ───────────────────────────────────

describe("contestedNotice — every tooltip contains 'contested'", () => {
  for (const origin of ALL_ORIGINS) {
    it(`origin '${origin}' with no verdict: tooltip contains 'contested'`, () => {
      const { tooltip } = contestedNotice({ origin });
      expect(tooltip.toLowerCase()).toContain("contested");
    });

    it(`origin '${origin}' with real verdict 'pass': tooltip contains 'contested'`, () => {
      const { tooltip } = contestedNotice({ origin, verdict: "pass" });
      expect(tooltip.toLowerCase()).toContain("contested");
    });
  }
});

// ─── No "no reason"/"not available" assertions ───────────────────────────────

describe("contestedNotice — no 'absence of rationale' assertions", () => {
  const FORBIDDEN_PHRASES = [
    "no reason",
    "not available",
    "unavailable",
    "no rationale",
    "no explanation available",
    "no cause",
  ];

  for (const origin of ALL_ORIGINS) {
    it(`origin '${origin}': tooltip never asserts absence of a rationale`, () => {
      const { tooltip } = contestedNotice({ origin });
      const lower = tooltip.toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(lower).not.toContain(phrase);
      }
    });
  }
});

// ─── 'in-run' branch ─────────────────────────────────────────────────────────

describe("contestedNotice — in-run branch", () => {
  it("without reason: uses base tooltip verbatim", () => {
    const { tooltip } = contestedNotice({ origin: "in-run" });
    expect(tooltip).toContain("flagged as broken or disputed at the rubric level");
    expect(tooltip).toContain("excluded from the score on both sides");
  });

  it("with reason: appends the reason to the base tooltip", () => {
    const { tooltip } = contestedNotice({ origin: "in-run", reason: "Definition loop detected" });
    expect(tooltip).toContain("flagged as broken or disputed at the rubric level");
    expect(tooltip).toContain("Definition loop detected");
  });

  it("with null reason: omits it cleanly (does not add a placeholder)", () => {
    const { tooltip } = contestedNotice({ origin: "in-run", reason: null });
    expect(tooltip).not.toContain("null");
    // Should be the base tooltip only
    expect(tooltip.trim()).toBe(contestedNotice({ origin: "in-run" }).tooltip.trim());
  });

  it("with empty string reason: treated as absent, no placeholder emitted", () => {
    const { tooltip } = contestedNotice({ origin: "in-run", reason: "   " });
    expect(tooltip.trim()).toBe(contestedNotice({ origin: "in-run" }).tooltip.trim());
  });

  it("verdict is ignored for label/tooltip content (label stays CONTESTED)", () => {
    const withVerdict = contestedNotice({ origin: "in-run", verdict: "pass" });
    const withoutVerdict = contestedNotice({ origin: "in-run" });
    expect(withVerdict.label).toBe("CONTESTED");
    expect(withVerdict.tooltip).toBe(withoutVerdict.tooltip);
  });

  it("matchedBy is ignored for in-run (no provenance hedging needed)", () => {
    const withId = contestedNotice({ origin: "in-run", matchedBy: "id" });
    const withTitle = contestedNotice({ origin: "in-run", matchedBy: "title" });
    const noMatch = contestedNotice({ origin: "in-run", matchedBy: null });
    expect(withId.tooltip).toBe(noMatch.tooltip);
    expect(withTitle.tooltip).toBe(noMatch.tooltip);
  });
});

// ─── 'both' branch ───────────────────────────────────────────────────────────

describe("contestedNotice — both branch", () => {
  it("label is CONTESTED (same as in-run)", () => {
    expect(contestedNotice({ origin: "both" }).label).toBe("CONTESTED");
  });

  it("tooltip includes the base contested copy", () => {
    const { tooltip } = contestedNotice({ origin: "both" });
    expect(tooltip).toContain("flagged as broken or disputed at the rubric level");
  });

  it("tooltip notes that the roster ALSO flags this criterion", () => {
    const { tooltip } = contestedNotice({ origin: "both" });
    expect(tooltip.toLowerCase()).toContain("roster");
  });

  it("with reason: appends reason AND roster note", () => {
    const { tooltip } = contestedNotice({ origin: "both", reason: "Ambiguous scope" });
    expect(tooltip).toContain("Ambiguous scope");
    expect(tooltip.toLowerCase()).toContain("roster");
    expect(tooltip).toContain("flagged as broken or disputed at the rubric level");
  });

  it("with null reason: roster note still present without reason text", () => {
    const { tooltip } = contestedNotice({ origin: "both", reason: null });
    expect(tooltip.toLowerCase()).toContain("roster");
    expect(tooltip).not.toContain("null");
  });
});

// ─── 'roster' branch ─────────────────────────────────────────────────────────

describe("contestedNotice — roster branch", () => {
  it("label is 'PRIOR CONTEST'", () => {
    expect(contestedNotice({ origin: "roster" }).label).toBe("PRIOR CONTEST");
  });

  it("tooltip mentions 'previous run' (flagged from prior run)", () => {
    const { tooltip } = contestedNotice({ origin: "roster" });
    expect(tooltip.toLowerCase()).toContain("previous run");
  });

  it("without verdict: uses 'not judged in this run' variant", () => {
    const { tooltip } = contestedNotice({ origin: "roster" });
    expect(tooltip.toLowerCase()).toContain("not judged in this run");
    expect(tooltip.toLowerCase()).toContain("excluded from the score");
  });

  it("with empty verdict: uses 'not judged' variant", () => {
    const { tooltip } = contestedNotice({ origin: "roster", verdict: "" });
    expect(tooltip.toLowerCase()).toContain("not judged in this run");
  });

  it("with '?' verdict: uses 'not judged' variant", () => {
    const { tooltip } = contestedNotice({ origin: "roster", verdict: "?" });
    expect(tooltip.toLowerCase()).toContain("not judged in this run");
  });

  it("with real pass verdict: uses 'did not contest it' variant", () => {
    const { tooltip } = contestedNotice({ origin: "roster", verdict: "pass" });
    expect(tooltip.toLowerCase()).toContain("did not contest it");
    expect(tooltip.toLowerCase()).not.toContain("not judged in this run");
  });

  it("with real fail verdict: uses 'did not contest it' variant", () => {
    const { tooltip } = contestedNotice({ origin: "roster", verdict: "fail" });
    expect(tooltip.toLowerCase()).toContain("did not contest it");
  });

  it("with real PASS (uppercase) verdict: uses 'did not contest it' variant", () => {
    const { tooltip } = contestedNotice({ origin: "roster", verdict: "PASS" });
    expect(tooltip.toLowerCase()).toContain("did not contest it");
  });

  it("matchedBy='id': no title-hedge in copy", () => {
    const { tooltip } = contestedNotice({ origin: "roster", matchedBy: "id" });
    expect(tooltip.toLowerCase()).not.toContain("by title");
  });

  it("matchedBy='title': hedges provenance with 'by title'", () => {
    const { tooltip } = contestedNotice({ origin: "roster", matchedBy: "title" });
    expect(tooltip.toLowerCase()).toContain("by title");
  });

  it("matchedBy='title' with real verdict: hedges provenance AND uses 'did not contest it'", () => {
    const { tooltip } = contestedNotice({ origin: "roster", matchedBy: "title", verdict: "pass" });
    expect(tooltip.toLowerCase()).toContain("by title");
    expect(tooltip.toLowerCase()).toContain("did not contest it");
  });

  it("matchedBy=null: no title-hedge in copy", () => {
    const { tooltip } = contestedNotice({ origin: "roster", matchedBy: null });
    expect(tooltip.toLowerCase()).not.toContain("by title");
  });

  it("reason is ignored for roster-only origin (no reason slot in this branch)", () => {
    // The roster branch is about the criterion never being judged; a contest-reason
    // field from the in-run bundle has no meaning here.
    const withReason = contestedNotice({ origin: "roster", reason: "Some reason" });
    const withoutReason = contestedNotice({ origin: "roster" });
    // Labels must both be PRIOR CONTEST
    expect(withReason.label).toBe("PRIOR CONTEST");
    // Tooltip content from both paths must contain "contested"
    expect(withReason.tooltip.toLowerCase()).toContain("contested");
    expect(withoutReason.tooltip.toLowerCase()).toContain("contested");
  });
});

// ─── 'unknown' branch ────────────────────────────────────────────────────────

describe("contestedNotice — unknown branch", () => {
  it("label is 'CONTESTED'", () => {
    expect(contestedNotice({ origin: "unknown" }).label).toBe("CONTESTED");
  });

  it("tooltip is the base contested text — no origin claim", () => {
    const { tooltip } = contestedNotice({ origin: "unknown" });
    expect(tooltip).toContain("flagged as broken or disputed at the rubric level");
    // Must not claim any specific origin
    expect(tooltip.toLowerCase()).not.toContain("previous run");
    expect(tooltip.toLowerCase()).not.toContain("roster");
    expect(tooltip.toLowerCase()).not.toContain("this run's judge");
  });

  it("verdict does not change the output", () => {
    const withVerdict = contestedNotice({ origin: "unknown", verdict: "pass" });
    const withoutVerdict = contestedNotice({ origin: "unknown" });
    expect(withVerdict.tooltip).toBe(withoutVerdict.tooltip);
  });

  it("reason is ignored (no slot for unknown origin)", () => {
    const withReason = contestedNotice({ origin: "unknown", reason: "test reason" });
    const withoutReason = contestedNotice({ origin: "unknown" });
    expect(withReason.tooltip).toBe(withoutReason.tooltip);
  });
});

// ─── Reason slot — forward-compatible across origins ─────────────────────────

describe("contestedNotice — reason slot (forward-compatible)", () => {
  it("in-run with reason: reason text appears in tooltip", () => {
    const reason = "Criterion scope is undefined across jurisdictions";
    const { tooltip } = contestedNotice({ origin: "in-run", reason });
    expect(tooltip).toContain(reason);
  });

  it("both with reason: reason text appears in tooltip", () => {
    const reason = "Overlapping rubric detected";
    const { tooltip } = contestedNotice({ origin: "both", reason });
    expect(tooltip).toContain(reason);
  });

  it("reason=null is a no-op (omitted, not placeholder)", () => {
    const noReason = contestedNotice({ origin: "in-run", reason: null });
    const withReason = contestedNotice({ origin: "in-run", reason: "explanation" });
    // Without a reason the tooltip must be shorter (just the base text)
    expect(noReason.tooltip.length).toBeLessThan(withReason.tooltip.length);
    expect(noReason.tooltip).not.toContain("explanation");
  });
});

// ─── roster branch reason clause (new) ───────────────────────────────────────

describe("contestedNotice — roster branch with reason clause (new)", () => {
  it("roster branch appends reason when provided", () => {
    const { tooltip } = contestedNotice({ origin: "roster", reason: "Criterion scope undefined" });
    expect(tooltip).toContain("previous run");
    expect(tooltip).toContain("Criterion scope undefined");
  });

  it("roster branch omits reason cleanly when null", () => {
    const withReason = contestedNotice({ origin: "roster", reason: "Some reason" });
    const withoutReason = contestedNotice({ origin: "roster", reason: null });
    expect(withoutReason.tooltip).not.toContain("Some reason");
    expect(withoutReason.tooltip.toLowerCase()).toContain("contested");
  });

  it("roster branch omits reason cleanly when empty string", () => {
    const withoutReason = contestedNotice({ origin: "roster", reason: "   " });
    expect(withoutReason.tooltip).not.toContain("   ");
    // Should be the same as no reason
    const noReason = contestedNotice({ origin: "roster" });
    expect(withoutReason.tooltip).toBe(noReason.tooltip);
  });

  it("roster branch reason appended after the judement clause", () => {
    const { tooltip } = contestedNotice({ origin: "roster", reason: "My reason", verdict: "fail" });
    const reasonPos = tooltip.indexOf("My reason");
    const judgePos = tooltip.indexOf("did not contest");
    expect(reasonPos).toBeGreaterThan(judgePos);
  });
});
