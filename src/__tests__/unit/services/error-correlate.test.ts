/**
 * Unit tests for src/services/error-issues/correlate.ts
 *
 * Covers:
 * - No kgRefId → skips gracefully (no-op)
 * - KG unreachable → no-op, does not throw
 * - No File nodes linked → no correlation written
 * - No PR candidates → no correlation written
 * - No PRs before onset timestamp → no correlation written
 * - Single clear PR match → confidence "high", written to DB
 * - Multiple close candidates → confidence "likely", candidates array written
 * - KG call throws → no-op, does not propagate
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockKgGetNeighbors, mockIssueUpdate } = vi.hoisted(() => ({
  mockKgGetNeighbors: vi.fn(),
  mockIssueUpdate: vi.fn(),
}));

vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetNeighbors: mockKgGetNeighbors,
}));

vi.mock("@/lib/db", () => ({
  db: {
    errorIssue: {
      update: mockIssueUpdate,
    },
  },
}));

import { correlateErrorIssue } from "@/services/error-issues/correlate";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const JARVIS_CONFIG = { jarvisUrl: "http://jarvis.test", apiKey: "test-key" };
const ISSUE_ID = "issue-1";
const KG_REF_ID = "kg-issue-ref";
const ONSET_AT = new Date("2025-06-01T12:00:00Z");
const COMMIT_SHA = "abc123def456";
const ONSET_REASON = "new";

const FILE_NODE = {
  ref_id: "kg-file-1",
  node_type: "File",
  name: "app/models/user.rb",
  edgeType: "REFERENCES",
  direction: "forward" as const,
  urn: "",
};

function makePrNeighbor(overrides: Partial<{
  ref_id: string;
  name: string;
  mergeDate: string;
  number: number;
  url: string;
}> = {}) {
  const { ref_id = "kg-pr-1", name = "PR #101", mergeDate = "2025-05-30T10:00:00Z", number = 101, url = "https://github.com/org/repo/pull/101" } = overrides;
  return {
    ref_id,
    node_type: "PullRequest",
    name,
    edgeType: "MODIFIES",
    direction: "forward" as const,
    urn: "",
    properties: { number, url, merged_at: mergeDate },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockIssueUpdate.mockResolvedValue({});
});

describe("correlateErrorIssue — guard conditions", () => {
  it("skips when kgRefId is null — no KG call, no DB write", async () => {
    await correlateErrorIssue(ISSUE_ID, null, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON);
    expect(mockKgGetNeighbors).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("skips when kgRefId is undefined — no KG call, no DB write", async () => {
    await correlateErrorIssue(ISSUE_ID, undefined, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON);
    expect(mockKgGetNeighbors).not.toHaveBeenCalled();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("returns gracefully when KG is unreachable (reachable=false)", async () => {
    mockKgGetNeighbors.mockResolvedValue({ neighbors: [], reachable: false });
    await expect(
      correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON),
    ).resolves.toBeUndefined();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("does not throw when kgGetNeighbors throws", async () => {
    mockKgGetNeighbors.mockRejectedValue(new Error("Network failure"));
    await expect(
      correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON),
    ).resolves.toBeUndefined();
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });
});

describe("correlateErrorIssue — no File nodes", () => {
  it("writes nothing when the issue has no REFERENCES-linked File nodes", async () => {
    // First call for File nodes — reachable but empty
    mockKgGetNeighbors.mockResolvedValue({ neighbors: [], reachable: true });

    await correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON);
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });
});

describe("correlateErrorIssue — no PR candidates", () => {
  it("writes nothing when File nodes have no PullRequest neighbors", async () => {
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [FILE_NODE], reachable: true }) // File nodes
      .mockResolvedValueOnce({ neighbors: [], reachable: true });           // No PRs

    await correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON);
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });

  it("writes nothing when all PR candidates are AFTER the onset timestamp", async () => {
    // PR merged 2 days AFTER onset
    const futurePr = makePrNeighbor({ mergeDate: "2025-06-03T12:00:00Z" });
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [FILE_NODE], reachable: true })
      .mockResolvedValueOnce({ neighbors: [futurePr], reachable: true });

    await correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON);
    expect(mockIssueUpdate).not.toHaveBeenCalled();
  });
});

describe("correlateErrorIssue — single clear match", () => {
  it("writes high confidence when one PR is clearly the most recent before onset", async () => {
    const pr = makePrNeighbor({ mergeDate: "2025-05-30T10:00:00Z", number: 101, url: "https://github.com/org/repo/pull/101" });
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [FILE_NODE], reachable: true })
      .mockResolvedValueOnce({ neighbors: [pr], reachable: true });

    await correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON);

    expect(mockIssueUpdate).toHaveBeenCalledOnce();
    const updateData = mockIssueUpdate.mock.calls[0][0].data;
    expect(updateData.correlationConfidence).toBe("high");
    expect(updateData.correlatedPrNumber).toBe(101);
    expect(updateData.correlatedPrUrl).toBe("https://github.com/org/repo/pull/101");
    expect(updateData.correlatedCommitSha).toBe(COMMIT_SHA);
    expect(updateData.correlationCandidates).toBeUndefined();
    expect(updateData.correlationComputedAt).toBeInstanceOf(Date);
  });

  it("picks the most recent PR when multiple exist but are spread apart (> 24h)", async () => {
    // Best: 2 days before onset. Runner-up: 4 days before onset (> 24h gap → not close)
    const bestPr = makePrNeighbor({ ref_id: "kg-pr-1", mergeDate: "2025-05-30T12:00:00Z", number: 101 });
    const olderPr = makePrNeighbor({ ref_id: "kg-pr-2", mergeDate: "2025-05-27T12:00:00Z", number: 99 });

    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [FILE_NODE], reachable: true })
      .mockResolvedValueOnce({ neighbors: [olderPr, bestPr], reachable: true }); // unordered

    await correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON);

    const updateData = mockIssueUpdate.mock.calls[0][0].data;
    expect(updateData.correlationConfidence).toBe("high");
    expect(updateData.correlatedPrNumber).toBe(101); // most recent wins
  });

  it("stores commitSha=null when not provided", async () => {
    const pr = makePrNeighbor();
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [FILE_NODE], reachable: true })
      .mockResolvedValueOnce({ neighbors: [pr], reachable: true });

    await correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, null, JARVIS_CONFIG, ONSET_REASON);

    const updateData = mockIssueUpdate.mock.calls[0][0].data;
    expect(updateData.correlatedCommitSha).toBeUndefined(); // null → undefined in update
  });
});

describe("correlateErrorIssue — multiple close candidates", () => {
  it("stores likely confidence and candidates array when two PRs are within 24h of each other", async () => {
    // Best: 2h before onset. Runner-up: 14h before onset (< 24h gap → close)
    const bestPr = makePrNeighbor({
      ref_id: "kg-pr-1",
      mergeDate: "2025-06-01T10:00:00Z", // 2h before onset
      number: 101,
      url: "https://github.com/org/repo/pull/101",
    });
    const closePr = makePrNeighbor({
      ref_id: "kg-pr-2",
      mergeDate: "2025-05-31T22:00:00Z", // 14h before onset
      number: 99,
      url: "https://github.com/org/repo/pull/99",
    });

    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [FILE_NODE], reachable: true })
      .mockResolvedValueOnce({ neighbors: [closePr, bestPr], reachable: true });

    await correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON);

    const updateData = mockIssueUpdate.mock.calls[0][0].data;
    expect(updateData.correlationConfidence).toBe("likely");
    expect(updateData.correlatedPrNumber).toBe(101); // best candidate still set
    expect(Array.isArray(updateData.correlationCandidates)).toBe(true);
    expect(updateData.correlationCandidates).toHaveLength(2);
    // Candidates are sorted most-recent first
    expect(updateData.correlationCandidates[0].prNumber).toBe(101);
    expect(updateData.correlationCandidates[1].prNumber).toBe(99);
  });

  it("caps candidates at 3 when many close PRs exist", async () => {
    const prs = Array.from({ length: 5 }, (_, i) =>
      makePrNeighbor({
        ref_id: `kg-pr-${i}`,
        // All within 12h of onset (close)
        mergeDate: new Date(ONSET_AT.getTime() - (i + 1) * 2 * 3600 * 1000).toISOString(),
        number: 100 + i,
      }),
    );

    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [FILE_NODE], reachable: true })
      .mockResolvedValueOnce({ neighbors: prs, reachable: true });

    await correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON);

    const updateData = mockIssueUpdate.mock.calls[0][0].data;
    expect(updateData.correlationConfidence).toBe("likely");
    expect(updateData.correlationCandidates).toHaveLength(3); // capped at MAX_LIKELY_CANDIDATES
  });
});

describe("correlateErrorIssue — multiple File nodes deduplication", () => {
  it("deduplicates PR candidates across multiple File nodes", async () => {
    const fileNode2 = { ...FILE_NODE, ref_id: "kg-file-2" };
    const sharedPr = makePrNeighbor({ ref_id: "kg-pr-shared" });

    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [FILE_NODE, fileNode2], reachable: true })
      .mockResolvedValueOnce({ neighbors: [sharedPr], reachable: true }) // file 1 → shared PR
      .mockResolvedValueOnce({ neighbors: [sharedPr], reachable: true }); // file 2 → same PR

    await correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON);

    // Should still result in a single high-confidence match (not counted twice)
    const updateData = mockIssueUpdate.mock.calls[0][0].data;
    expect(updateData.correlationConfidence).toBe("high");
    expect(updateData.correlatedPrNumber).toBe(sharedPr.properties.number);
  });
});

describe("correlateErrorIssue — DB update failure", () => {
  it("does not throw when the DB update fails", async () => {
    const pr = makePrNeighbor();
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [FILE_NODE], reachable: true })
      .mockResolvedValueOnce({ neighbors: [pr], reachable: true });

    mockIssueUpdate.mockRejectedValue(new Error("DB error"));

    await expect(
      correlateErrorIssue(ISSUE_ID, KG_REF_ID, ONSET_AT, COMMIT_SHA, JARVIS_CONFIG, ONSET_REASON),
    ).resolves.toBeUndefined();
  });
});
