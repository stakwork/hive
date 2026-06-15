import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock db
vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    task: {
      updateMany: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock pr-monitor exports used by the janitor
vi.mock("@/lib/github/pr-monitor", () => ({
  parsePRUrl: vi.fn((url: string) => {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!m) return null;
    return { owner: m[1], repo: m[2], prNumber: parseInt(m[3], 10) };
  }),
  getOctokitForWorkspace: vi.fn(),
}));

import { findStalePRTasks, archiveStalePRTasks } from "@/lib/github/stale-pr-janitor";
import { db } from "@/lib/db";
import { getOctokitForWorkspace } from "@/lib/github/pr-monitor";

const mockDb = db as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  task: { updateMany: ReturnType<typeof vi.fn> };
  workspace: { findUnique: ReturnType<typeof vi.fn> };
};

const mockGetOctokitForWorkspace = getOctokitForWorkspace as ReturnType<typeof vi.fn>;

const makeMockOctokit = () => ({
  pulls: { update: vi.fn().mockResolvedValue({}) },
  issues: { createComment: vi.fn().mockResolvedValue({}) },
});

const sampleRow = {
  artifact_id: "art-1",
  task_id: "task-1",
  task_title: "Fix login bug",
  pr_url: "https://github.com/org/repo/pull/42",
  state: "ci_failure",
  repo_url: "https://github.com/org/repo",
  stuck_since_days: 10,
  workspace_id: "ws-1",
};

describe("findStalePRTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns mapped tasks from raw query results", async () => {
    mockDb.$queryRaw.mockResolvedValue([sampleRow]);

    const result = await findStalePRTasks({ thresholdDays: 7 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      taskId: "task-1",
      taskTitle: "Fix login bug",
      prUrl: "https://github.com/org/repo/pull/42",
      state: "ci_failure",
      repoUrl: "https://github.com/org/repo",
      stuckSinceDays: 10,
      artifactId: "art-1",
      workspaceId: "ws-1",
    });
  });

  it("returns empty array when no rows found", async () => {
    mockDb.$queryRaw.mockResolvedValue([]);

    const result = await findStalePRTasks({ thresholdDays: 7 });

    expect(result).toHaveLength(0);
  });

  it("returns empty array immediately when taskIds is empty array", async () => {
    const result = await findStalePRTasks({ thresholdDays: 7, taskIds: [] });

    expect(result).toHaveLength(0);
    expect(mockDb.$queryRaw).not.toHaveBeenCalled();
  });

  it("calls queryRaw when taskIds are provided (bypasses state filter)", async () => {
    mockDb.$queryRaw.mockResolvedValue([sampleRow]);

    const result = await findStalePRTasks({
      thresholdDays: 7,
      taskIds: ["task-1", "task-2", "task-3"],
    });

    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);

    // Verify the SQL template was called — we can't easily inspect the raw SQL
    // but we confirm it ran without error and returned the mapped result
    const [callArg] = mockDb.$queryRaw.mock.calls[0];
    // The first argument is a TemplateStringsArray; check it's a tagged template call
    expect(Array.isArray(callArg)).toBe(true);
  });

  it("includes workspaceId filter in SQL when provided", async () => {
    mockDb.$queryRaw.mockResolvedValue([]);

    await findStalePRTasks({ thresholdDays: 7, workspaceId: "ws-abc" });

    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1);
    // Prisma tagged template interpolates values as array elements after the strings array.
    const callJson = JSON.stringify(mockDb.$queryRaw.mock.calls[0]);
    expect(callJson).toContain("ws-abc");
  });

  it("includes repoUrl filter in SQL when provided", async () => {
    mockDb.$queryRaw.mockResolvedValue([]);

    await findStalePRTasks({
      thresholdDays: 7,
      repoUrl: "https://github.com/org/repo",
    });

    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1);
    // The repoUrl is passed inside a Prisma.sql fragment as an interpolated value.
    // Verify via JSON serialization that the value is present somewhere in the call args.
    const callJson = JSON.stringify(mockDb.$queryRaw.mock.calls[0]);
    expect(callJson).toContain("https://github.com/org/repo%");
  });

  it("converts stuck_since_days to a number", async () => {
    // Simulate PostgreSQL returning NUMERIC as string
    mockDb.$queryRaw.mockResolvedValue([
      { ...sampleRow, stuck_since_days: "8.7" },
    ]);

    const result = await findStalePRTasks({ thresholdDays: 7 });

    expect(typeof result[0].stuckSinceDays).toBe("number");
    expect(result[0].stuckSinceDays).toBe(8.7);
  });
});

describe("archiveStalePRTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.task.updateMany.mockResolvedValue({ count: 2 });
    mockDb.$executeRaw.mockResolvedValue(2);
    mockDb.workspace.findUnique.mockResolvedValue({ ownerId: "owner-1" });
  });

  it("returns archivedCount from updateMany result", async () => {
    const octokit = makeMockOctokit();
    mockGetOctokitForWorkspace.mockResolvedValue(octokit);

    const tasks = [
      { taskId: "task-1", artifactId: "art-1", prUrl: "https://github.com/org/repo/pull/42", workspaceId: "ws-1" },
      { taskId: "task-2", artifactId: "art-2", prUrl: "https://github.com/org/repo/pull/43", workspaceId: "ws-1" },
    ];

    const result = await archiveStalePRTasks(tasks);

    expect(result.archivedCount).toBe(2);
  });

  it("calls task.updateMany with correct task IDs and archived=true", async () => {
    const octokit = makeMockOctokit();
    mockGetOctokitForWorkspace.mockResolvedValue(octokit);

    const tasks = [
      { taskId: "task-1", artifactId: "art-1", prUrl: "https://github.com/org/repo/pull/42", workspaceId: "ws-1" },
      { taskId: "task-2", artifactId: "art-2", prUrl: "https://github.com/org/repo/pull/43", workspaceId: "ws-1" },
    ];

    await archiveStalePRTasks(tasks);

    expect(mockDb.task.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["task-1", "task-2"] } },
      data: expect.objectContaining({ archived: true, archivedAt: expect.any(Date) }),
    });
  });

  it("calls $executeRaw to cancel artifacts", async () => {
    const octokit = makeMockOctokit();
    mockGetOctokitForWorkspace.mockResolvedValue(octokit);

    const tasks = [
      { taskId: "task-1", artifactId: "art-1", prUrl: "https://github.com/org/repo/pull/42", workspaceId: "ws-1" },
    ];

    await archiveStalePRTasks(tasks);

    expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
    const callJson = JSON.stringify(mockDb.$executeRaw.mock.calls[0]);
    expect(callJson).toContain("art-1");
  });

  it("returns archivedCount of 0 and closedPrCount of 0 for empty array without hitting DB", async () => {
    const result = await archiveStalePRTasks([]);

    expect(result.archivedCount).toBe(0);
    expect(result.closedPrCount).toBe(0);
    expect(mockDb.task.updateMany).not.toHaveBeenCalled();
    expect(mockDb.$executeRaw).not.toHaveBeenCalled();
  });

  // --- New tests for GitHub PR closure ---

  it("happy path: closes PRs and posts comments, returns correct closedPrCount", async () => {
    const octokit = makeMockOctokit();
    mockGetOctokitForWorkspace.mockResolvedValue(octokit);
    mockDb.task.updateMany.mockResolvedValue({ count: 2 });

    const tasks = [
      {
        taskId: "task-1",
        artifactId: "art-1",
        prUrl: "https://github.com/org/repo/pull/42",
        workspaceId: "ws-1",
        state: "ci_failure" as const,
        stuckSinceDays: 10,
      },
      {
        taskId: "task-2",
        artifactId: "art-2",
        prUrl: "https://github.com/org/repo/pull/43",
        workspaceId: "ws-1",
        state: "conflict" as const,
        stuckSinceDays: 5,
      },
    ];

    const result = await archiveStalePRTasks(tasks);

    expect(result.closedPrCount).toBe(2);
    expect(result.archivedCount).toBe(2);

    expect(octokit.pulls.update).toHaveBeenCalledTimes(2);
    expect(octokit.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "org", repo: "repo", pull_number: 42, state: "closed" }),
    );
    expect(octokit.pulls.update).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "org", repo: "repo", pull_number: 43, state: "closed" }),
    );

    expect(octokit.issues.createComment).toHaveBeenCalledTimes(2);
    const [firstCommentCall] = octokit.issues.createComment.mock.calls;
    expect(firstCommentCall[0].body).toContain("Stale CI Task Janitor");
    expect(firstCommentCall[0].body).toContain("archived");
  });

  it("GitHub API error: archival still completes, closedPrCount is 0, error is logged", async () => {
    const octokit = makeMockOctokit();
    octokit.pulls.update.mockRejectedValue(new Error("GitHub API error"));
    mockGetOctokitForWorkspace.mockResolvedValue(octokit);
    mockDb.task.updateMany.mockResolvedValue({ count: 1 });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const tasks = [
      {
        taskId: "task-1",
        artifactId: "art-1",
        prUrl: "https://github.com/org/repo/pull/42",
        workspaceId: "ws-1",
        state: "ci_failure" as const,
      },
    ];

    const result = await archiveStalePRTasks(tasks);

    expect(result.archivedCount).toBe(1);
    expect(result.closedPrCount).toBe(0);
    expect(mockDb.task.updateMany).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to close GitHub PR"),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it("token not found (getOctokitForWorkspace returns null): archival completes, closedPrCount is 0", async () => {
    mockGetOctokitForWorkspace.mockResolvedValue(null);
    mockDb.task.updateMany.mockResolvedValue({ count: 1 });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const tasks = [
      {
        taskId: "task-1",
        artifactId: "art-1",
        prUrl: "https://github.com/org/repo/pull/42",
        workspaceId: "ws-1",
        state: "ci_failure" as const,
      },
    ];

    const result = await archiveStalePRTasks(tasks);

    expect(result.archivedCount).toBe(1);
    expect(result.closedPrCount).toBe(0);
    expect(mockDb.task.updateMany).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("No GitHub token available"),
    );

    consoleSpy.mockRestore();
  });

  it("malformed PR URL: task archived, no Octokit call made, warning logged", async () => {
    const octokit = makeMockOctokit();
    mockGetOctokitForWorkspace.mockResolvedValue(octokit);
    mockDb.task.updateMany.mockResolvedValue({ count: 1 });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const tasks = [
      {
        taskId: "task-1",
        artifactId: "art-1",
        prUrl: "not-a-valid-url",
        workspaceId: "ws-1",
        state: "ci_failure" as const,
      },
    ];

    const result = await archiveStalePRTasks(tasks);

    expect(result.archivedCount).toBe(1);
    expect(result.closedPrCount).toBe(0);
    expect(octokit.pulls.update).not.toHaveBeenCalled();
    expect(octokit.issues.createComment).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("malformed PR URL"),
    );

    warnSpy.mockRestore();
  });

  it("partial failure: archivedCount equals total, closedPrCount equals success count only", async () => {
    const octokitSuccess = makeMockOctokit();
    const octokitFail = makeMockOctokit();
    octokitFail.pulls.update.mockRejectedValue(new Error("rate limited"));

    // First call succeeds, second fails
    mockGetOctokitForWorkspace
      .mockResolvedValueOnce(octokitSuccess)
      .mockResolvedValueOnce(octokitFail);

    // Each workspace has its own workspace.findUnique call
    mockDb.workspace.findUnique.mockResolvedValue({ ownerId: "owner-1" });
    mockDb.task.updateMany.mockResolvedValue({ count: 2 });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const tasks = [
      {
        taskId: "task-1",
        artifactId: "art-1",
        prUrl: "https://github.com/org/repo/pull/42",
        workspaceId: "ws-1",
        state: "ci_failure" as const,
      },
      {
        taskId: "task-2",
        artifactId: "art-2",
        prUrl: "https://github.com/org/repo/pull/43",
        workspaceId: "ws-2",
        state: "conflict" as const,
      },
    ];

    const result = await archiveStalePRTasks(tasks);

    expect(result.archivedCount).toBe(2);
    expect(result.closedPrCount).toBe(1);

    consoleSpy.mockRestore();
  });

  it("comment body includes reason and days stuck when provided", async () => {
    const octokit = makeMockOctokit();
    mockGetOctokitForWorkspace.mockResolvedValue(octokit);
    mockDb.task.updateMany.mockResolvedValue({ count: 1 });

    const tasks = [
      {
        taskId: "task-1",
        artifactId: "art-1",
        prUrl: "https://github.com/org/repo/pull/42",
        workspaceId: "ws-1",
        state: "conflict" as const,
        stuckSinceDays: 14,
      },
    ];

    await archiveStalePRTasks(tasks);

    const commentBody = octokit.issues.createComment.mock.calls[0][0].body as string;
    expect(commentBody).toContain("merge conflict");
    expect(commentBody).toContain("14 days");
  });
});
