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

const { mockFindUnique, mockUpdate, mockPusherTrigger, mockEventFindMany, mockEventCount } =
  vi.hoisted(() => ({
    mockFindUnique: vi.fn(),
    mockUpdate: vi.fn(),
    mockPusherTrigger: vi.fn(),
    mockEventFindMany: vi.fn(),
    mockEventCount: vi.fn(),
  }));

vi.mock("@/lib/db", () => ({
  db: {
    errorIssue: {
      findUnique: mockFindUnique,
      update: mockUpdate,
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

import { updateErrorIssueStatus, InvalidStatusError, getErrorIssueDetail } from "@/services/error-issues";

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
