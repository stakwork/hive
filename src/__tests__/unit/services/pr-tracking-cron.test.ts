import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock the GitHub App utilities
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

const { db: mockDb } = await import("@/lib/db");
const { getUserAppTokens: mockGetUserAppTokens } = await import("@/lib/githubApp");
const { executePRTracking } = await import("@/services/pr-tracking-cron");

describe("executePRTracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should find and mark tasks as DONE when PRs are merged", async () => {
    const now = new Date("2024-10-28T12:00:00Z");
    const mergedAt = new Date("2024-10-28T11:00:00Z");

    // Mock tasks with open PRs
    const tasksWithPRs = [
      {
        id: "task-1",
        title: "Implement feature X",
        prUrl: "https://github.com/owner/repo/pull/new/feature-x",
        prBranch: "feature-x",
        prMergedAt: null,
        status: "IN_PROGRESS",
        workspace: {
          ownerId: "user-1",
          sourceControlOrg: {
            githubLogin: "my-org",
          },
          owner: {
            id: "user-1",
          },
        },
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(tasksWithPRs as any);
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);
    vi.mocked(mockGetUserAppTokens).mockResolvedValue({
      accessToken: "github-token-123",
    } as any);

    // Mock GitHub API response - PR is merged
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          number: 123,
          state: "closed",
          merged_at: mergedAt.toISOString(),
        },
      ],
    } as any);

    const result = await executePRTracking();

    // Verify the query was made correctly
    expect(mockDb.task.findMany).toHaveBeenCalledWith({
      where: {
        mode: "agent",
        prUrl: {
          not: null,
        },
        prBranch: {
          not: null,
        },
        prMergedAt: null,
        status: {
          in: ["IN_PROGRESS", "TODO"],
        },
        deleted: false,
      },
      include: {
        workspace: {
          include: {
            sourceControlOrg: true,
            owner: true,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Verify GitHub API was called
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/pulls?state=all&head=owner:feature-x",
      {
        headers: {
          Authorization: "token github-token-123",
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    // Verify task was updated to DONE
    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        status: "DONE",
        prMergedAt: mergedAt,
        workflowStatus: "COMPLETED",
        workflowCompletedAt: mergedAt,
      },
    });

    // Verify result
    expect(result.success).toBe(true);
    expect(result.tasksProcessed).toBe(1);
    expect(result.tasksCompleted).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.timestamp).toBeDefined();
  });

  test("should not mark tasks as DONE when PRs are not merged", async () => {
    const tasksWithPRs = [
      {
        id: "task-1",
        title: "Implement feature X",
        prUrl: "https://github.com/owner/repo/pull/new/feature-x",
        prBranch: "feature-x",
        prMergedAt: null,
        status: "IN_PROGRESS",
        workspace: {
          ownerId: "user-1",
          sourceControlOrg: {
            githubLogin: "my-org",
          },
          owner: {
            id: "user-1",
          },
        },
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(tasksWithPRs as any);
    vi.mocked(mockGetUserAppTokens).mockResolvedValue({
      accessToken: "github-token-123",
    } as any);

    // Mock GitHub API response - PR exists but not merged
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          number: 123,
          state: "open",
          merged_at: null,
        },
      ],
    } as any);

    const result = await executePRTracking();

    // Verify task was NOT updated
    expect(mockDb.task.update).not.toHaveBeenCalled();

    // Verify result
    expect(result.success).toBe(true);
    expect(result.tasksProcessed).toBe(1);
    expect(result.tasksCompleted).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test("should handle case when no PR exists for the branch", async () => {
    const tasksWithPRs = [
      {
        id: "task-1",
        title: "Implement feature X",
        prUrl: "https://github.com/owner/repo/pull/new/feature-x",
        prBranch: "feature-x",
        prMergedAt: null,
        status: "IN_PROGRESS",
        workspace: {
          ownerId: "user-1",
          sourceControlOrg: {
            githubLogin: "my-org",
          },
          owner: {
            id: "user-1",
          },
        },
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(tasksWithPRs as any);
    vi.mocked(mockGetUserAppTokens).mockResolvedValue({
      accessToken: "github-token-123",
    } as any);

    // Mock GitHub API response - no PRs found
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => [],
    } as any);

    const result = await executePRTracking();

    // Verify task was NOT updated
    expect(mockDb.task.update).not.toHaveBeenCalled();

    // Verify result
    expect(result.success).toBe(true);
    expect(result.tasksProcessed).toBe(1);
    expect(result.tasksCompleted).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test("should handle multiple tasks with different PR states", async () => {
    const mergedAt = new Date("2024-10-28T11:00:00Z");

    const tasksWithPRs = [
      {
        id: "task-1",
        title: "Task 1 - Merged",
        prUrl: "https://github.com/owner/repo/pull/new/feature-1",
        prBranch: "feature-1",
        prMergedAt: null,
        status: "IN_PROGRESS",
        workspace: {
          ownerId: "user-1",
          sourceControlOrg: { githubLogin: "my-org" },
          owner: { id: "user-1" },
        },
      },
      {
        id: "task-2",
        title: "Task 2 - Not Merged",
        prUrl: "https://github.com/owner/repo/pull/new/feature-2",
        prBranch: "feature-2",
        prMergedAt: null,
        status: "IN_PROGRESS",
        workspace: {
          ownerId: "user-1",
          sourceControlOrg: { githubLogin: "my-org" },
          owner: { id: "user-1" },
        },
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(tasksWithPRs as any);
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);
    vi.mocked(mockGetUserAppTokens).mockResolvedValue({
      accessToken: "github-token-123",
    } as any);

    // Mock different responses for each PR
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ number: 1, state: "closed", merged_at: mergedAt.toISOString() }],
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ number: 2, state: "open", merged_at: null }],
      } as any);

    const result = await executePRTracking();

    // Verify only the merged task was updated
    expect(mockDb.task.update).toHaveBeenCalledTimes(1);
    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        status: "DONE",
        prMergedAt: mergedAt,
        workflowStatus: "COMPLETED",
        workflowCompletedAt: mergedAt,
      },
    });

    // Verify result
    expect(result.success).toBe(true);
    expect(result.tasksProcessed).toBe(2);
    expect(result.tasksCompleted).toBe(1);
    expect(result.errors).toEqual([]);
  });

  test("should handle GitHub API errors gracefully", async () => {
    const tasksWithPRs = [
      {
        id: "task-1",
        title: "Task 1",
        prUrl: "https://github.com/owner/repo/pull/new/feature-1",
        prBranch: "feature-1",
        prMergedAt: null,
        status: "IN_PROGRESS",
        workspace: {
          ownerId: "user-1",
          sourceControlOrg: { githubLogin: "my-org" },
          owner: { id: "user-1" },
        },
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(tasksWithPRs as any);
    vi.mocked(mockGetUserAppTokens).mockResolvedValue({
      accessToken: "github-token-123",
    } as any);

    // Mock GitHub API error
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    const result = await executePRTracking();

    // Verify task was NOT updated
    expect(mockDb.task.update).not.toHaveBeenCalled();

    // Verify result
    expect(result.success).toBe(true);
    expect(result.tasksProcessed).toBe(1);
    expect(result.tasksCompleted).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test("should handle missing GitHub token", async () => {
    const tasksWithPRs = [
      {
        id: "task-1",
        title: "Task 1",
        prUrl: "https://github.com/owner/repo/pull/new/feature-1",
        prBranch: "feature-1",
        prMergedAt: null,
        status: "IN_PROGRESS",
        workspace: {
          ownerId: "user-1",
          sourceControlOrg: { githubLogin: "my-org" },
          owner: { id: "user-1" },
        },
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(tasksWithPRs as any);
    vi.mocked(mockGetUserAppTokens).mockResolvedValue(null);

    const result = await executePRTracking();

    // Verify task was NOT updated
    expect(mockDb.task.update).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    // Verify result shows error
    expect(result.success).toBe(false);
    expect(result.tasksProcessed).toBe(1);
    expect(result.tasksCompleted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      taskId: "task-1",
      error: "No GitHub access token available",
    });
  });

  test("should handle invalid PR URL", async () => {
    const tasksWithPRs = [
      {
        id: "task-1",
        title: "Task 1",
        prUrl: "invalid-url",
        prBranch: "feature-1",
        prMergedAt: null,
        status: "IN_PROGRESS",
        workspace: {
          ownerId: "user-1",
          sourceControlOrg: { githubLogin: "my-org" },
          owner: { id: "user-1" },
        },
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(tasksWithPRs as any);
    vi.mocked(mockGetUserAppTokens).mockResolvedValue({
      accessToken: "github-token-123",
    } as any);

    const result = await executePRTracking();

    // Verify GitHub API was NOT called
    expect(global.fetch).not.toHaveBeenCalled();

    // Verify error was recorded
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      taskId: "task-1",
      error: "Could not parse PR URL: invalid-url",
    });
  });

  test("should handle missing sourceControlOrg", async () => {
    const tasksWithPRs = [
      {
        id: "task-1",
        title: "Task 1",
        prUrl: "https://github.com/owner/repo/pull/new/feature-1",
        prBranch: "feature-1",
        prMergedAt: null,
        status: "IN_PROGRESS",
        workspace: {
          ownerId: "user-1",
          sourceControlOrg: null,
          owner: { id: "user-1" },
        },
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(tasksWithPRs as any);

    const result = await executePRTracking();

    // Verify GitHub API was NOT called
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockGetUserAppTokens).not.toHaveBeenCalled();

    // Verify task was skipped (no error)
    expect(result.success).toBe(true);
    expect(result.tasksProcessed).toBe(1);
    expect(result.tasksCompleted).toBe(0);
    expect(result.errors).toEqual([]);
  });

  test("should handle database errors when updating tasks", async () => {
    const mergedAt = new Date("2024-10-28T11:00:00Z");

    const tasksWithPRs = [
      {
        id: "task-1",
        title: "Task 1",
        prUrl: "https://github.com/owner/repo/pull/new/feature-1",
        prBranch: "feature-1",
        prMergedAt: null,
        status: "IN_PROGRESS",
        workspace: {
          ownerId: "user-1",
          sourceControlOrg: { githubLogin: "my-org" },
          owner: { id: "user-1" },
        },
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(tasksWithPRs as any);
    vi.mocked(mockDb.task.update).mockRejectedValue(new Error("Database error"));
    vi.mocked(mockGetUserAppTokens).mockResolvedValue({
      accessToken: "github-token-123",
    } as any);

    // Mock merged PR
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => [{ number: 123, state: "closed", merged_at: mergedAt.toISOString() }],
    } as any);

    const result = await executePRTracking();

    // Verify error was recorded
    expect(result.success).toBe(false);
    expect(result.tasksCompleted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      taskId: "task-1",
      error: "Database error",
    });
  });

  test("should handle critical errors during execution", async () => {
    // Mock a critical error in findMany
    vi.mocked(mockDb.task.findMany).mockRejectedValue(new Error("Database connection failed"));

    const result = await executePRTracking();

    // Verify result
    expect(result.success).toBe(false);
    expect(result.tasksProcessed).toBe(0);
    expect(result.tasksCompleted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      taskId: "SYSTEM",
      error: "Critical execution error: Database connection failed",
    });
  });

  test("should only target agent mode tasks", async () => {
    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await executePRTracking();

    // Verify the query specifically filters for agent mode
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    expect(findManyCall?.where?.mode).toBe("agent");
  });

  test("should only target tasks with non-null PR URL and branch", async () => {
    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await executePRTracking();

    // Verify the query filters for non-null prUrl and prBranch
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    expect(findManyCall?.where?.prUrl).toEqual({ not: null });
    expect(findManyCall?.where?.prBranch).toEqual({ not: null });
  });

  test("should only target tasks that haven't been marked as merged", async () => {
    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await executePRTracking();

    // Verify the query filters for null prMergedAt
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    expect(findManyCall?.where?.prMergedAt).toBe(null);
  });

  test("should not target deleted tasks", async () => {
    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await executePRTracking();

    // Verify the query specifically filters out deleted tasks
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    expect(findManyCall?.where?.deleted).toBe(false);
  });

  test("should include workspace and sourceControlOrg in query", async () => {
    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await executePRTracking();

    // Verify the query includes necessary relations
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    expect(findManyCall?.include).toEqual({
      workspace: {
        include: {
          sourceControlOrg: true,
          owner: true,
        },
      },
    });
  });
});
