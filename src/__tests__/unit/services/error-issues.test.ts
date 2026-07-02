/**
 * Unit tests for src/services/error-issues.ts
 *
 * Covers:
 * - updateErrorIssueStatus allowlist rejection (InvalidStatusError)
 * - Pusher broadcast on status update
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ErrorIssueStatus } from "@prisma/client";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockFindUnique, mockUpdate, mockPusherTrigger } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockPusherTrigger: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    errorIssue: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: mockPusherTrigger },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: { ERROR_ISSUE_UPDATED: "error-issue-updated" },
}));

import { updateErrorIssueStatus, InvalidStatusError } from "@/services/error-issues";

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
