/**
 * `services/trace/matchUpstream.ts` — finding where a highlighted
 * selection reads verbatim in an earlier step's output, with whitespace
 * and thousands-separator normalizing.
 */

import { describe, expect, test } from "vitest";
import { containsSelection, matchUpstream, normalizeForMatch } from "@/services/trace/matchUpstream";
import type { TraceSourceStep } from "@/services/trace/types";

describe("normalizeForMatch", () => {
  test("strips thousands separators from numbers", () => {
    expect(normalizeForMatch("Total: $12,338.84")).toBe("Total: $12338.84");
    expect(normalizeForMatch("1,000,000 users")).toBe("1000000 users");
  });

  test("collapses whitespace", () => {
    expect(normalizeForMatch("a   b\n\tc")).toBe("a b c");
  });
});

describe("containsSelection", () => {
  test("matches verbatim", () => {
    expect(containsSelection("the total is $12,338.84 today", "$12,338.84")).toBe(true);
  });

  test("matches after normalizing commas and whitespace", () => {
    expect(containsSelection("total:  $12338.84", "$12,338.84")).toBe(true);
    expect(containsSelection("Acme  Corp owes $12,338.84", "Acme Corp")).toBe(true);
  });

  test("does not match an unrelated value", () => {
    expect(containsSelection("the total is $9.00", "$12,338.84")).toBe(false);
  });

  test("an empty selection never matches", () => {
    expect(containsSelection("anything", "")).toBe(false);
  });
});

function step(partial: Partial<TraceSourceStep> & Pick<TraceSourceStep, "order">): TraceSourceStep {
  return { key: `k${partial.order}`, toolName: "tool", input: "", output: "", ...partial };
}

describe("matchUpstream", () => {
  const steps: TraceSourceStep[] = [
    step({ order: 0, toolName: "search/accounts", output: "Found 1 account: Acme Corp (id acct_1)", toolCallId: "call-1" }),
    step({
      order: 1,
      toolName: "billing/sum-invoices",
      output: "Total across all invoices for Acme Corp (acct_1): $12,338.84",
      toolCallId: "call-2",
      nodes: [{ ref_id: "acct_1", node_type: "Account" }],
    }),
    step({ order: 2, toolName: "report/write-summary", output: "Wrote the summary: Acme Corp owes $12,338.84 across Q1.", toolCallId: "call-3" }),
  ];

  test("finds every step whose output holds the selection, nearest first", () => {
    const links = matchUpstream("$12,338.84", steps);
    expect(links.map((l) => l.toolCallId)).toEqual(["call-3", "call-2"]);
    expect(links[0].match).toBe("exact");
    expect(links[1].nodes).toEqual([{ ref_id: "acct_1", node_type: "Account" }]);
  });

  test("only looks before `beforeOrder` — a step is never its own source", () => {
    const links = matchUpstream("$12,338.84", steps, 2);
    expect(links.map((l) => l.toolCallId)).toEqual(["call-2"]);
  });

  test("an excerpt is a window around the match, not the whole output", () => {
    const long = "x".repeat(300) + "$12,338.84" + "y".repeat(300);
    const links = matchUpstream("$12,338.84", [step({ order: 0, output: long, toolCallId: "call-1" })]);
    expect(links[0].excerpt.length).toBeLessThan(long.length);
    expect(links[0].excerpt).toContain("$12,338.84");
  });

  test("no match gives no links", () => {
    expect(matchUpstream("nowhere to be found", steps)).toEqual([]);
    expect(matchUpstream("", steps)).toEqual([]);
  });
});
