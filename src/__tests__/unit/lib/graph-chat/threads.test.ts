import { describe, it, expect } from "vitest";
import {
  groupRunsIntoThreads,
  filterProposalsForSession,
  latestReflection,
  type ThreadSourceRun,
} from "@/lib/graph-chat/threads";
import type { ConceptProposal } from "@/types/concept-proposals";

function run(overrides: Partial<ThreadSourceRun>): ThreadSourceRun {
  return {
    sessionId: "s1",
    title: "Title",
    proposalsEnabled: false,
    status: "DELIVERED_WEBHOOK",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("groupRunsIntoThreads", () => {
  it("groups runs by sessionId with title from the FIRST run and status/setting from the LATEST", () => {
    const threads = groupRunsIntoThreads([
      run({ title: "Opening prompt", updatedAt: "2026-08-01T10:00:00.000Z" }),
      run({
        title: "Follow-up (ignored)",
        status: "PENDING",
        proposalsEnabled: true,
        updatedAt: "2026-08-01T11:00:00.000Z",
      }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toEqual({
      sessionId: "s1",
      title: "Opening prompt",
      proposalsEnabled: true,
      lastStatus: "PENDING",
      updatedAt: "2026-08-01T11:00:00.000Z",
    });
  });

  it("orders threads newest activity first", () => {
    const threads = groupRunsIntoThreads([
      run({ sessionId: "old", updatedAt: "2026-08-01T09:00:00.000Z" }),
      run({ sessionId: "new", updatedAt: "2026-08-02T09:00:00.000Z" }),
      run({ sessionId: "mid", updatedAt: "2026-08-01T15:00:00.000Z" }),
    ]);
    expect(threads.map((t) => t.sessionId)).toEqual(["new", "mid", "old"]);
  });

  it("skips rows without a sessionId and accepts Date objects", () => {
    const threads = groupRunsIntoThreads([
      run({ sessionId: null }),
      run({
        sessionId: "s2",
        createdAt: new Date("2026-08-01T10:00:00.000Z"),
        updatedAt: new Date("2026-08-01T10:00:00.000Z"),
      }),
    ]);
    expect(threads).toHaveLength(1);
    expect(threads[0].sessionId).toBe("s2");
    expect(threads[0].updatedAt).toBe("2026-08-01T10:00:00.000Z");
  });

  it("returns an empty list for no runs", () => {
    expect(groupRunsIntoThreads([])).toEqual([]);
  });
});

describe("filterProposalsForSession", () => {
  function proposal(overrides: Partial<ConceptProposal>): ConceptProposal {
    return {
      id: "p1",
      action: "update",
      status: "pending",
      rationale: "why",
      source: "graph_chat",
      prNumbers: [],
      createdAt: "2026-08-01T10:00:00.000Z",
      repo: "stakwork/hive",
      ...overrides,
    };
  }

  it("keeps only proposals whose sessionIds include the thread's session", () => {
    const matched = proposal({ id: "match", sessionIds: ["other", "s1"] });
    const unmatched = proposal({ id: "nope", sessionIds: ["other"] });
    expect(filterProposalsForSession([matched, unmatched], "s1")).toEqual([matched]);
  });

  it("treats missing or empty sessionIds as no match", () => {
    const none = proposal({ id: "none", sessionIds: undefined });
    const empty = proposal({ id: "empty", sessionIds: [] });
    expect(filterProposalsForSession([none, empty], "s1")).toEqual([]);
  });
});

describe("latestReflection", () => {
  it("returns the reflection from the LATEST run carrying one (runs are oldest-first)", () => {
    const early = { session_id: "s1", concepts: [{ id: "a", rank: null }] };
    const late = {
      session_id: "s1",
      concepts: [
        { id: "a", rank: null },
        { id: "b", rank: null },
      ],
    };
    const runs = [{ reflection: early }, { reflection: null }, { reflection: late }, { reflection: undefined }];
    expect(latestReflection(runs)).toBe(late);
  });

  it("returns null when no run carries a reflection", () => {
    expect(latestReflection([{ reflection: null }, {}])).toBeNull();
    expect(latestReflection([])).toBeNull();
  });
});
