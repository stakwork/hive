/**
 * Unit tests for src/services/error-issues.ts
 *
 * Covers:
 * - updateErrorIssueStatus allowlist rejection (InvalidStatusError)
 * - Pusher broadcast on status update
 * - getErrorIssueDetail returns commitSha, repositoryUrl, defaultBranch
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
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockIssueFindMany: vi.fn(),
  mockIssueCount: vi.fn(),
  mockPusherTrigger: vi.fn(),
  mockEventFindMany: vi.fn(),
  mockEventCount: vi.fn(),
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

import { updateErrorIssueStatus, InvalidStatusError, getErrorIssueDetail, listErrorIssues } from "@/services/error-issues";

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
