/**
 * `services/trace/walkDownstream.ts` — the later steps that used a
 * selection that came from a middle step, up to the final output.
 */

import { describe, expect, test } from "vitest";
import { walkDownstream } from "@/services/trace/walkDownstream";
import type { TraceSourceStep } from "@/services/trace/types";

function step(partial: Partial<TraceSourceStep> & Pick<TraceSourceStep, "order">): TraceSourceStep {
  return { key: `k${partial.order}`, toolName: "tool", input: "", output: "", ...partial };
}

describe("walkDownstream", () => {
  const steps: TraceSourceStep[] = [
    step({ order: 0, toolName: "search/accounts", output: "Found acct_1", toolCallId: "call-1" }),
    step({ order: 1, toolName: "billing/sum-invoices", input: "{\"accountId\":\"acct_1\"}", output: "Total: $12,338.84", toolCallId: "call-2" }),
    step({ order: 2, toolName: "report/write-summary", input: "{\"total\":\"$12,338.84\",\"account\":\"Acme Corp\"}", output: "Wrote the summary.", toolCallId: "call-3" }),
    step({ order: 3, toolName: "assistant message", input: "", output: "Acme Corp owes $12,338.84 across Q1.", key: "m-2" }),
  ];

  test("finds later steps whose input holds the selection, in order", () => {
    const links = walkDownstream("$12,338.84", steps, 1);
    expect(links.map((l) => l.toolCallId)).toEqual(["call-3"]);
    expect(links[0].match).toBe("exact");
  });

  test("steps at or before the origin are never downstream of it", () => {
    expect(walkDownstream("$12,338.84", steps, 2)).toEqual([]);
  });

  test("matches after normalizing, same as matchUpstream", () => {
    const later = [step({ order: 5, input: "total was 12338.84 dollars", toolCallId: "call-9" })];
    expect(walkDownstream("$12,338.84", later, 0)).toHaveLength(0); // "$" itself isn't in the normalized input
    expect(walkDownstream("12,338.84", later, 0)).toHaveLength(1);
  });

  test("an empty selection finds nothing", () => {
    expect(walkDownstream("", steps, 0)).toEqual([]);
  });
});
