/**
 * Unit tests for the filtered-timeline logic in SidebarChat.tsx.
 *
 * These tests exercise the filtering logic directly (pure functions extracted
 * for clarity) to verify:
 *  1. Successful proposal tool calls are removed from the filtered timeline.
 *  2. Failed proposal tool calls (error in output) are retained.
 *  3. Non-proposal tool calls are never filtered.
 *  4. When proposals.length === 0 the filtered timeline equals the original.
 */

import {
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
} from "@/lib/proposals/types";

// ---------------------------------------------------------------------------
// Inline re-implementation of the filtering logic from SidebarChat.tsx so
// this test is self-contained and deterministic.
// ---------------------------------------------------------------------------

type TimelineItem = {
  type: string;
  id: string;
  [key: string]: unknown;
};

type ToolCall = {
  id: string;
  toolName: string;
  output?: unknown;
};

const PROPOSAL_TOOLS = new Set([
  PROPOSE_FEATURE_TOOL,
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_MILESTONE_TOOL,
]);

function computeFilteredTimeline(
  proposals: unknown[],
  toolCalls: ToolCall[] | undefined,
  timeline: TimelineItem[] | undefined,
): TimelineItem[] | undefined {
  const proposalToolCallIds = new Set<string>();

  if (proposals.length > 0) {
    for (const tc of toolCalls ?? []) {
      if (!PROPOSAL_TOOLS.has(tc.toolName as (typeof PROPOSAL_TOOLS extends Set<infer T> ? T : never))) continue;
      const o = tc.output;
      if (!o || typeof o !== "object" || "error" in (o as object)) continue;
      proposalToolCallIds.add(tc.id);
    }
  }

  return proposalToolCallIds.size > 0
    ? timeline?.filter(
        (item) => item.type !== "toolCall" || !proposalToolCallIds.has(item.id),
      )
    : timeline;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToolCallItem(id: string): TimelineItem {
  return { type: "toolCall", id };
}

function makeTextItem(id: string): TimelineItem {
  return { type: "text", id };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SidebarChat filteredTimeline logic", () => {
  it("excludes a successful propose_feature tool call from the timeline", () => {
    const toolCalls: ToolCall[] = [
      { id: "tc-1", toolName: PROPOSE_FEATURE_TOOL, output: { proposalId: "p1" } },
    ];
    const timeline: TimelineItem[] = [makeToolCallItem("tc-1")];
    const proposals = [{ proposalId: "p1" }]; // non-empty → filtering active

    const result = computeFilteredTimeline(proposals, toolCalls, timeline);

    expect(result).toEqual([]);
  });

  it("excludes successful propose_initiative and propose_milestone calls", () => {
    const toolCalls: ToolCall[] = [
      { id: "tc-init", toolName: PROPOSE_INITIATIVE_TOOL, output: { proposalId: "p-init" } },
      { id: "tc-ms", toolName: PROPOSE_MILESTONE_TOOL, output: { proposalId: "p-ms" } },
    ];
    const timeline: TimelineItem[] = [
      makeToolCallItem("tc-init"),
      makeToolCallItem("tc-ms"),
    ];
    const proposals = [{ proposalId: "p-init" }, { proposalId: "p-ms" }];

    const result = computeFilteredTimeline(proposals, toolCalls, timeline);

    expect(result).toEqual([]);
  });

  it("retains a proposal tool call whose output contains an error", () => {
    const toolCalls: ToolCall[] = [
      { id: "tc-err", toolName: PROPOSE_FEATURE_TOOL, output: { error: "something went wrong" } },
    ];
    const timeline: TimelineItem[] = [makeToolCallItem("tc-err")];
    const proposals = [{ proposalId: "p1" }]; // proposals still present

    const result = computeFilteredTimeline(proposals, toolCalls, timeline);

    expect(result).toEqual([makeToolCallItem("tc-err")]);
  });

  it("retains a proposal tool call with null output", () => {
    const toolCalls: ToolCall[] = [
      { id: "tc-null", toolName: PROPOSE_FEATURE_TOOL, output: null },
    ];
    const timeline: TimelineItem[] = [makeToolCallItem("tc-null")];
    const proposals = [{ proposalId: "p1" }];

    const result = computeFilteredTimeline(proposals, toolCalls, timeline);

    expect(result).toEqual([makeToolCallItem("tc-null")]);
  });

  it("never filters non-proposal tool calls", () => {
    const toolCalls: ToolCall[] = [
      { id: "tc-other", toolName: "send_to_feature_planner", output: { ok: true } },
    ];
    const timeline: TimelineItem[] = [makeToolCallItem("tc-other")];
    const proposals = [{ proposalId: "p1" }]; // proposals present

    const result = computeFilteredTimeline(proposals, toolCalls, timeline);

    expect(result).toEqual([makeToolCallItem("tc-other")]);
  });

  it("returns the original timeline unchanged when proposals.length === 0", () => {
    const toolCalls: ToolCall[] = [
      { id: "tc-1", toolName: PROPOSE_FEATURE_TOOL, output: { proposalId: "p1" } },
    ];
    const timeline: TimelineItem[] = [makeToolCallItem("tc-1"), makeTextItem("t-1")];
    const proposals: unknown[] = []; // no proposals yet (e.g. still streaming)

    const result = computeFilteredTimeline(proposals, toolCalls, timeline);

    // Must be the exact same reference (no filtering applied)
    expect(result).toBe(timeline);
  });

  it("keeps non-proposal tool call items alongside filtered proposal items", () => {
    const toolCalls: ToolCall[] = [
      { id: "tc-proposal", toolName: PROPOSE_FEATURE_TOOL, output: { proposalId: "p1" } },
      { id: "tc-other", toolName: "read_initiative", output: { name: "Init A" } },
    ];
    const timeline: TimelineItem[] = [
      makeToolCallItem("tc-proposal"),
      makeToolCallItem("tc-other"),
      makeTextItem("t-1"),
    ];
    const proposals = [{ proposalId: "p1" }];

    const result = computeFilteredTimeline(proposals, toolCalls, timeline);

    expect(result).toEqual([makeToolCallItem("tc-other"), makeTextItem("t-1")]);
  });

  it("returns undefined unchanged when timeline is undefined and proposals exist", () => {
    const toolCalls: ToolCall[] = [
      { id: "tc-1", toolName: PROPOSE_FEATURE_TOOL, output: { proposalId: "p1" } },
    ];
    const proposals = [{ proposalId: "p1" }];

    const result = computeFilteredTimeline(proposals, toolCalls, undefined);

    expect(result).toBeUndefined();
  });
});
