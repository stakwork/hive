/**
 * Unit tests for src/services/error-issues.ts
 *
 * Covers:
 * - updateErrorIssueStatus allowlist rejection (InvalidStatusError)
 * - Pusher broadcast on status update
 * - getErrorIssueDetail returns commitSha, repositoryUrl, defaultBranch
 * - getRelatedErrorIssues traversal, ranking, caps, and bail-out paths
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErrorIssueStatus } from "@prisma/client";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockFindUnique,
  mockUpdate,
  mockIssueFindMany,
  mockIssueCount,
  mockPusherTrigger,
  mockEventFindMany,
  mockEventCount,
  mockGetJarvisConfig,
  mockKgGetNeighbors,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockIssueFindMany: vi.fn(),
  mockIssueCount: vi.fn(),
  mockPusherTrigger: vi.fn(),
  mockEventFindMany: vi.fn(),
  mockEventCount: vi.fn(),
  mockGetJarvisConfig: vi.fn(),
  mockKgGetNeighbors: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    errorIssue: {
      findUnique: mockFindUnique,
      update: mockUpdate,
      findMany: mockIssueFindMany,
      count: mockIssueCount,
    },
    errorEvent: {
      findMany: mockEventFindMany,
      count: mockEventCount,
    },
  },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: mockPusherTrigger },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: { ERROR_ISSUE_UPDATED: "error-issue-updated" },
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfig,
}));

vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetNeighbors: mockKgGetNeighbors,
}));

import {
  updateErrorIssueStatus,
  InvalidStatusError,
  getErrorIssueDetail,
  listErrorIssues,
  getRelatedErrorIssues,
} from "@/services/error-issues";

const MOCK_ISSUE = {
  id: "issue-1",
  workspaceId: "ws-1",
  repositoryId: "repo-1",
  fingerprint: "abc123",
  occurrenceCount: 5,
  status: "UNRESOLVED" as ErrorIssueStatus,
  lastSeenAt: new Date("2025-01-01T00:00:00Z"),
  workspace: { slug: "my-workspace" },
};

describe("updateErrorIssueStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue({ id: MOCK_ISSUE.id, workspaceId: MOCK_ISSUE.workspaceId, status: "UNRESOLVED" });
    mockUpdate.mockResolvedValue(MOCK_ISSUE);
    mockPusherTrigger.mockResolvedValue(undefined);
  });

  it("accepts RESOLVED", async () => {
    mockUpdate.mockResolvedValueOnce({ ...MOCK_ISSUE, status: "RESOLVED" });
    const result = await updateErrorIssueStatus("issue-1", "RESOLVED");
    expect(result.issue.status).toBe("RESOLVED");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RESOLVED" } }),
    );
  });

  it("accepts IGNORED", async () => {
    mockUpdate.mockResolvedValueOnce({ ...MOCK_ISSUE, status: "IGNORED" });
    await updateErrorIssueStatus("issue-1", "IGNORED");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "IGNORED" } }),
    );
  });

  it("accepts UNRESOLVED", async () => {
    mockUpdate.mockResolvedValueOnce({ ...MOCK_ISSUE, status: "UNRESOLVED" });
    await updateErrorIssueStatus("issue-1", "UNRESOLVED");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "UNRESOLVED" } }),
    );
  });

  it("throws InvalidStatusError for an arbitrary string", async () => {
    await expect(updateErrorIssueStatus("issue-1", "OPEN")).rejects.toThrow(InvalidStatusError);
  });

  it("throws InvalidStatusError for empty string", async () => {
    await expect(updateErrorIssueStatus("issue-1", "")).rejects.toThrow(InvalidStatusError);
  });

  it("throws InvalidStatusError for lowercase 'resolved'", async () => {
    await expect(updateErrorIssueStatus("issue-1", "resolved")).rejects.toThrow(InvalidStatusError);
  });

  it("broadcasts ERROR_ISSUE_UPDATED on Pusher after update", async () => {
    await updateErrorIssueStatus("issue-1", "RESOLVED");
    expect(mockPusherTrigger).toHaveBeenCalledWith(
      "workspace-my-workspace",
      "error-issue-updated",
      expect.objectContaining({
        id: MOCK_ISSUE.id,
        isNew: false,
        status: MOCK_ISSUE.status,
        occurrenceCount: MOCK_ISSUE.occurrenceCount,
      }),
    );
  });

  it("does not throw when Pusher broadcast fails (non-fatal)", async () => {
    mockPusherTrigger.mockRejectedValue(new Error("Pusher down"));
    await expect(updateErrorIssueStatus("issue-1", "RESOLVED")).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getErrorIssueDetail
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_ISSUE_DETAIL = {
  id: "issue-1",
  workspaceId: "ws-1",
  repositoryId: "repo-1",
  repoKey: "stakwork/hive",
  fingerprint: "abc123",
  exceptionType: "TypeError",
  title: "TypeError: cannot read property x of undefined",
  status: "UNRESOLVED" as ErrorIssueStatus,
  occurrenceCount: 5,
  firstSeenAt: new Date("2025-01-01T00:00:00Z"),
  lastSeenAt: new Date("2025-01-02T00:00:00Z"),
  environment: "production",
  release: "v1.2.3",
  metadata: null,
  kgRefId: null,
};

const MOCK_RAW_EVENT = {
  id: "event-1",
  issueId: "issue-1",
  workspaceId: "ws-1",
  repositoryId: "repo-1",
  repoKey: "stakwork/hive",
  exceptionType: "TypeError",
  message: "cannot read property x of undefined",
  environment: "production",
  release: "v1.2.3",
  fingerprint: "abc123",
  commitSha: "deadbeef1234567890abcdef1234567890abcdef",
  createdAt: new Date("2025-01-02T00:00:00Z"),
  repository: {
    repositoryUrl: "https://github.com/stakwork/hive",
    branch: "master",
  },
};

describe("getErrorIssueDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(MOCK_ISSUE_DETAIL);
    mockEventFindMany.mockResolvedValue([MOCK_RAW_EVENT]);
    mockEventCount.mockResolvedValue(1);
  });

  it("returns null when issue does not exist", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const result = await getErrorIssueDetail("nonexistent");
    expect(result).toBeNull();
  });

  it("returns issue with flattened event fields", async () => {
    const result = await getErrorIssueDetail("issue-1");
    expect(result).not.toBeNull();
    expect(result!.issue.id).toBe("issue-1");
    expect(result!.events).toHaveLength(1);
  });

  it("includes commitSha on each event", async () => {
    const result = await getErrorIssueDetail("issue-1");
    expect(result!.events[0].commitSha).toBe("deadbeef1234567890abcdef1234567890abcdef");
  });

  it("flattens repositoryUrl from nested repository relation", async () => {
    const result = await getErrorIssueDetail("issue-1");
    expect(result!.events[0].repositoryUrl).toBe("https://github.com/stakwork/hive");
  });

  it("flattens branch as defaultBranch from nested repository relation", async () => {
    const result = await getErrorIssueDetail("issue-1");
    expect(result!.events[0].defaultBranch).toBe("master");
  });

  it("returns null repositoryUrl and defaultBranch when repository is null", async () => {
    mockEventFindMany.mockResolvedValueOnce([{ ...MOCK_RAW_EVENT, repository: null }]);
    const result = await getErrorIssueDetail("issue-1");
    expect(result!.events[0].repositoryUrl).toBeNull();
    expect(result!.events[0].defaultBranch).toBeNull();
  });

  it("returns null commitSha when event has no commitSha", async () => {
    mockEventFindMany.mockResolvedValueOnce([{ ...MOCK_RAW_EVENT, commitSha: null }]);
    const result = await getErrorIssueDetail("issue-1");
    expect(result!.events[0].commitSha).toBeNull();
  });

  it("does not expose raw nested repository object on events", async () => {
    const result = await getErrorIssueDetail("issue-1");
    expect((result!.events[0] as Record<string, unknown>).repository).toBeUndefined();
  });

  it("returns correct eventsTotal and eventsHasMore", async () => {
    mockEventCount.mockResolvedValueOnce(25);
    const result = await getErrorIssueDetail("issue-1", 20, 0);
    expect(result!.eventsTotal).toBe(25);
    expect(result!.eventsHasMore).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listErrorIssues
// ─────────────────────────────────────────────────────────────────────────────

describe("listErrorIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueFindMany.mockResolvedValue([]);
    mockIssueCount.mockResolvedValue(0);
  });

  it("applies notIn([RESOLVED, IGNORED]) by default (no status, no includeAll)", async () => {
    await listErrorIssues({ workspaceId: "ws-1" });

    const expectedWhere = {
      workspaceId: "ws-1",
      status: { notIn: ["RESOLVED", "IGNORED"] },
    };
    expect(mockIssueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(mockIssueCount).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it("applies no status constraint when includeAll is true", async () => {
    await listErrorIssues({ workspaceId: "ws-1", includeAll: true });

    const expectedWhere = { workspaceId: "ws-1" };
    expect(mockIssueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(mockIssueCount).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it("applies exact status match when a concrete status is provided", async () => {
    await listErrorIssues({ workspaceId: "ws-1", status: "RESOLVED" });

    const expectedWhere = { workspaceId: "ws-1", status: "RESOLVED" };
    expect(mockIssueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
    expect(mockIssueCount).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it("uses the same where clause for both findMany and count (pagination totals are consistent)", async () => {
    await listErrorIssues({ workspaceId: "ws-1", status: "UNRESOLVED" });

    const findManyWhere = mockIssueFindMany.mock.calls[0][0].where;
    const countWhere = mockIssueCount.mock.calls[0][0].where;
    expect(findManyWhere).toEqual(countWhere);
  });

  it("includes repoKey in where clause when provided", async () => {
    await listErrorIssues({ workspaceId: "ws-1", repoKey: "stakwork/hive" });

    expect(mockIssueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ repoKey: "stakwork/hive" }),
      }),
    );
  });

  it("returns hasMore: true when total exceeds skip+limit", async () => {
    mockIssueCount.mockResolvedValue(50);
    mockIssueFindMany.mockResolvedValue([]);
    const result = await listErrorIssues({ workspaceId: "ws-1", skip: 0, limit: 20 });
    expect(result.hasMore).toBe(true);
  });

  it("returns hasMore: false when total is within skip+limit", async () => {
    mockIssueCount.mockResolvedValue(5);
    mockIssueFindMany.mockResolvedValue([]);
    const result = await listErrorIssues({ workspaceId: "ws-1", skip: 0, limit: 20 });
    expect(result.hasMore).toBe(false);
  });

  it("orders by lastSeenAt desc by default (recent sort)", async () => {
    await listErrorIssues({ workspaceId: "ws-1" });
    expect(mockIssueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ lastSeenAt: "desc" }] }),
    );
  });

  it("orders by lastSeenAt desc when sort=recent is explicit", async () => {
    await listErrorIssues({ workspaceId: "ws-1", sort: "recent" });
    expect(mockIssueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ lastSeenAt: "desc" }] }),
    );
  });

  it("orders by impactScore desc (nulls last), then occurrenceCount, then lastSeenAt when sort=impact", async () => {
    await listErrorIssues({ workspaceId: "ws-1", sort: "impact" });
    expect(mockIssueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { impactScore: { sort: "desc", nulls: "last" } },
          { occurrenceCount: "desc" },
          { lastSeenAt: "desc" },
        ],
      }),
    );
  });

  it("selects impactScore, impactScoredAt, impactMeta in the result set", async () => {
    await listErrorIssues({ workspaceId: "ws-1" });
    const selectArg = mockIssueFindMany.mock.calls[0][0].select;
    expect(selectArg).toHaveProperty("impactScore", true);
    expect(selectArg).toHaveProperty("impactScoredAt", true);
    expect(selectArg).toHaveProperty("impactMeta", true);
  });
});

// ── getRelatedErrorIssues ─────────────────────────────────────────────────────

describe("getRelatedErrorIssues", () => {
  const SOURCE_ISSUE = {
    id: "issue-src",
    workspaceId: "ws-1",
    repositoryId: "repo-1",
    kgRefId: "kg-src",
  };

  const JARVIS_CONFIG = { jarvisUrl: "https://jarvis.example.com", apiKey: "test-key" };

  const makeKgNeighbor = (ref_id: string, node_type = "File") => ({
    ref_id,
    node_type,
    name: ref_id,
    direction: "forward" as const,
    title: ref_id,
  });

  const makeDbIssue = (id: string, status: ErrorIssueStatus, kgRefId: string, occurrenceCount = 1) => ({
    id,
    title: `Issue ${id}`,
    exceptionType: "RuntimeError",
    status,
    occurrenceCount,
    lastSeenAt: new Date("2025-06-01T00:00:00Z"),
    kgRefId,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindUnique.mockResolvedValue(SOURCE_ISSUE);
    mockGetJarvisConfig.mockResolvedValue(JARVIS_CONFIG);
    mockIssueFindMany.mockResolvedValue([]);
    mockKgGetNeighbors.mockResolvedValue({ neighbors: [], reachable: true });
  });

  it("returns [] when issue has no kgRefId", async () => {
    mockFindUnique.mockResolvedValue({ ...SOURCE_ISSUE, kgRefId: null });
    const result = await getRelatedErrorIssues("issue-src");
    expect(result).toEqual([]);
    expect(mockKgGetNeighbors).not.toHaveBeenCalled();
  });

  it("returns [] when issue is not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await getRelatedErrorIssues("not-found");
    expect(result).toEqual([]);
    expect(mockKgGetNeighbors).not.toHaveBeenCalled();
  });

  it("returns [] when jarvis config is null", async () => {
    mockGetJarvisConfig.mockResolvedValue(null);
    const result = await getRelatedErrorIssues("issue-src");
    expect(result).toEqual([]);
    expect(mockKgGetNeighbors).not.toHaveBeenCalled();
  });

  it("returns [] when hop-1 graph is unreachable", async () => {
    mockKgGetNeighbors.mockResolvedValue({ neighbors: [], reachable: false });
    const result = await getRelatedErrorIssues("issue-src");
    expect(result).toEqual([]);
  });

  it("returns [] when hop-1 has no code nodes", async () => {
    mockKgGetNeighbors.mockResolvedValue({ neighbors: [], reachable: true });
    const result = await getRelatedErrorIssues("issue-src");
    expect(result).toEqual([]);
    // Only hop-1 was called
    expect(mockKgGetNeighbors).toHaveBeenCalledTimes(1);
  });

  it("tallies shared-node counts correctly", async () => {
    // Hop 1: two code nodes
    const codeNode1 = makeKgNeighbor("file-1");
    const codeNode2 = makeKgNeighbor("file-2");
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [codeNode1, codeNode2], reachable: true }) // hop-1
      .mockResolvedValueOnce({ neighbors: [makeKgNeighbor("kg-sibling-1", "ErrorIssue")], reachable: true }) // hop-2 file-1
      .mockResolvedValueOnce({
        neighbors: [
          makeKgNeighbor("kg-sibling-1", "ErrorIssue"),
          makeKgNeighbor("kg-sibling-2", "ErrorIssue"),
        ],
        reachable: true,
      }); // hop-2 file-2

    mockIssueFindMany.mockResolvedValue([
      makeDbIssue("issue-a", "UNRESOLVED", "kg-sibling-1", 5),
      makeDbIssue("issue-b", "UNRESOLVED", "kg-sibling-2", 1),
    ]);

    const result = await getRelatedErrorIssues("issue-src");

    // sibling-1 shares 2 code nodes, sibling-2 shares 1 — sibling-1 should rank first
    expect(result[0].id).toBe("issue-a");
    expect(result[0].sharedCodeNodeCount).toBe(2);
    expect(result[1].id).toBe("issue-b");
    expect(result[1].sharedCodeNodeCount).toBe(1);
  });

  it("excludes the source issue from siblings", async () => {
    const codeNode = makeKgNeighbor("file-1");
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [codeNode], reachable: true }) // hop-1
      .mockResolvedValueOnce({
        neighbors: [
          makeKgNeighbor("kg-src", "ErrorIssue"), // source — must be excluded
          makeKgNeighbor("kg-sibling-1", "ErrorIssue"),
        ],
        reachable: true,
      }); // hop-2

    mockIssueFindMany.mockResolvedValue([
      makeDbIssue("issue-a", "UNRESOLVED", "kg-sibling-1"),
    ]);

    const result = await getRelatedErrorIssues("issue-src");
    expect(result).toHaveLength(1);
    expect(result[0].kgRefId).toBe("kg-sibling-1");
  });

  it("ranks unresolved issues before resolved/ignored", async () => {
    const codeNode = makeKgNeighbor("file-1");
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [codeNode], reachable: true })
      .mockResolvedValueOnce({
        neighbors: [
          makeKgNeighbor("kg-resolved", "ErrorIssue"),
          makeKgNeighbor("kg-unresolved", "ErrorIssue"),
          makeKgNeighbor("kg-ignored", "ErrorIssue"),
        ],
        reachable: true,
      });

    mockIssueFindMany.mockResolvedValue([
      makeDbIssue("issue-resolved", "RESOLVED", "kg-resolved"),
      makeDbIssue("issue-unresolved", "UNRESOLVED", "kg-unresolved"),
      makeDbIssue("issue-ignored", "IGNORED", "kg-ignored"),
    ]);

    const result = await getRelatedErrorIssues("issue-src");
    expect(result[0].status).toBe("UNRESOLVED");
    expect(result[1].status).not.toBe("UNRESOLVED");
  });

  it("caps results at 10", async () => {
    const codeNode = makeKgNeighbor("file-1");
    const siblingNeighbors = Array.from({ length: 15 }, (_, i) =>
      makeKgNeighbor(`kg-sib-${i}`, "ErrorIssue"),
    );
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [codeNode], reachable: true })
      .mockResolvedValueOnce({ neighbors: siblingNeighbors, reachable: true });

    const dbRows = Array.from({ length: 15 }, (_, i) =>
      makeDbIssue(`issue-${i}`, "UNRESOLVED", `kg-sib-${i}`),
    );
    mockIssueFindMany.mockResolvedValue(dbRows);

    const result = await getRelatedErrorIssues("issue-src");
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("skips hop-2 nodes that fail without failing the whole traversal", async () => {
    const codeNode1 = makeKgNeighbor("file-1");
    const codeNode2 = makeKgNeighbor("file-2");
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [codeNode1, codeNode2], reachable: true }) // hop-1
      .mockRejectedValueOnce(new Error("graph timeout")) // hop-2 file-1 fails
      .mockResolvedValueOnce({ neighbors: [makeKgNeighbor("kg-sib-1", "ErrorIssue")], reachable: true }); // hop-2 file-2 succeeds

    mockIssueFindMany.mockResolvedValue([makeDbIssue("issue-a", "UNRESOLVED", "kg-sib-1")]);

    const result = await getRelatedErrorIssues("issue-src");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("issue-a");
  });

  it("returns [] and does not throw on unexpected error", async () => {
    mockFindUnique.mockRejectedValue(new Error("DB connection lost"));
    await expect(getRelatedErrorIssues("issue-src")).resolves.toEqual([]);
  });

  it("calls findMany with workspace + repository scope", async () => {
    const codeNode = makeKgNeighbor("file-1");
    mockKgGetNeighbors
      .mockResolvedValueOnce({ neighbors: [codeNode], reachable: true })
      .mockResolvedValueOnce({ neighbors: [makeKgNeighbor("kg-sib-1", "ErrorIssue")], reachable: true });
    mockIssueFindMany.mockResolvedValue([]);

    await getRelatedErrorIssues("issue-src");

    expect(mockIssueFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: SOURCE_ISSUE.workspaceId,
          repositoryId: SOURCE_ISSUE.repositoryId,
          kgRefId: { in: ["kg-sib-1"] },
        }),
      }),
    );
  });
});
