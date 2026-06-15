import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock db
vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    task: {
      updateMany: vi.fn(),
    },
  },
}));

import { findStalePRTasks, archiveStalePRTasks } from "@/lib/github/stale-pr-janitor";
import { db } from "@/lib/db";

const mockDb = db as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  task: { updateMany: ReturnType<typeof vi.fn> };
};

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
  });

  it("returns archivedCount from updateMany result", async () => {
    const tasks = [
      { taskId: "task-1", artifactId: "art-1" },
      { taskId: "task-2", artifactId: "art-2" },
    ];

    const result = await archiveStalePRTasks(tasks);

    expect(result.archivedCount).toBe(2);
  });

  it("calls task.updateMany with correct task IDs and archived=true", async () => {
    const tasks = [
      { taskId: "task-1", artifactId: "art-1" },
      { taskId: "task-2", artifactId: "art-2" },
    ];

    await archiveStalePRTasks(tasks);

    expect(mockDb.task.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["task-1", "task-2"] } },
      data: expect.objectContaining({ archived: true, archivedAt: expect.any(Date) }),
    });
  });

  it("calls $executeRaw to cancel artifacts", async () => {
    const tasks = [{ taskId: "task-1", artifactId: "art-1" }];

    await archiveStalePRTasks(tasks);

    expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
    // Verify artifact IDs are passed via the interpolated values in the tagged template
    const callJson = JSON.stringify(mockDb.$executeRaw.mock.calls[0]);
    expect(callJson).toContain("art-1");
  });

  it("returns archivedCount of 0 for empty array without hitting DB", async () => {
    const result = await archiveStalePRTasks([]);

    expect(result.archivedCount).toBe(0);
    expect(mockDb.task.updateMany).not.toHaveBeenCalled();
    expect(mockDb.$executeRaw).not.toHaveBeenCalled();
  });
});
