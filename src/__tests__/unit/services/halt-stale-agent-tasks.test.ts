import { describe, test, expect, vi, beforeEach } from "vitest";
import { WorkflowStatus } from "@prisma/client";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const { db: mockDb } = await import("@/lib/db");
const { haltStaleAgentTasks, haltTask } = await import("@/services/task-coordinator-cron");

describe("haltStaleAgentTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  test("should find and halt agent tasks that have been pending for more than 24 hours", async () => {
    // Set current time
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    // Create a timestamp 25 hours ago (should be halted)
    const twentyFiveHoursAgo = new Date(now);
    twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

    // Mock stale tasks
    const staleTasks = [
      {
        id: "task-1",
        title: "Stale Agent Task 1",
        workspaceId: "workspace-1",
        workflowStartedAt: twentyFiveHoursAgo,
      },
      {
        id: "task-2",
        title: "Stale Agent Task 2",
        workspaceId: "workspace-1",
        workflowStartedAt: twentyFiveHoursAgo,
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(staleTasks as any);
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);

    const result = await haltStaleAgentTasks();

    // Verify the query was made correctly
    expect(mockDb.task.findMany).toHaveBeenCalledWith({
      where: {
        mode: "agent",
        workflowStatus: "PENDING",
        workflowStartedAt: {
          lt: expect.any(Date),
        },
        deleted: false,
      },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        workflowStartedAt: true,
      },
    });

    // Verify each task was updated
    expect(mockDb.task.update).toHaveBeenCalledTimes(2);
    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        workflowStatus: "HALTED",
        workflowCompletedAt: expect.any(Date),
      },
    });
    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: "task-2" },
      data: {
        workflowStatus: "HALTED",
        workflowCompletedAt: expect.any(Date),
      },
    });

    // Verify result
    expect(result.success).toBe(true);
    expect(result.tasksHalted).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.timestamp).toBeDefined();

    vi.useRealTimers();
  });

  test("should not halt tasks that have been pending for less than 24 hours", async () => {
    // Set current time
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    // No tasks returned (none are older than 24 hours)
    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    const result = await haltStaleAgentTasks();

    // Verify no updates were made
    expect(mockDb.task.update).not.toHaveBeenCalled();

    // Verify result
    expect(result.success).toBe(true);
    expect(result.tasksHalted).toBe(0);
    expect(result.errors).toEqual([]);

    vi.useRealTimers();
  });

  test("should handle errors when updating individual tasks", async () => {
    // Set current time
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const twentyFiveHoursAgo = new Date(now);
    twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

    const staleTasks = [
      {
        id: "task-1",
        title: "Task 1",
        workspaceId: "workspace-1",
        workflowStartedAt: twentyFiveHoursAgo,
      },
      {
        id: "task-2",
        title: "Task 2",
        workspaceId: "workspace-1",
        workflowStartedAt: twentyFiveHoursAgo,
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(staleTasks as any);

    // First update succeeds, second fails
    vi.mocked(mockDb.task.update)
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce(new Error("Database error"));

    const result = await haltStaleAgentTasks();

    // Verify result
    expect(result.success).toBe(false);
    expect(result.tasksHalted).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      taskId: "task-2",
      error: "Database error",
    });

    vi.useRealTimers();
  });

  test("should handle critical errors during execution", async () => {
    // Set current time
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    // Mock a critical error in findMany
    vi.mocked(mockDb.task.findMany).mockRejectedValue(new Error("Database connection failed"));

    const result = await haltStaleAgentTasks();

    // Verify result
    expect(result.success).toBe(false);
    expect(result.tasksHalted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      taskId: "SYSTEM",
      error: "Critical execution error: Database connection failed",
    });

    vi.useRealTimers();
  });

  test("should only target agent mode tasks", async () => {
    // Set current time
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await haltStaleAgentTasks();

    // Verify the query specifically filters for agent mode
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    expect(findManyCall?.where?.mode).toBe("agent");

    vi.useRealTimers();
  });

  test("should only target PENDING workflow status", async () => {
    // Set current time
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await haltStaleAgentTasks();

    // Verify the query specifically filters for PENDING status
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    expect(findManyCall?.where?.workflowStatus).toBe("PENDING");

    vi.useRealTimers();
  });

  test("should not target deleted tasks", async () => {
    // Set current time
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await haltStaleAgentTasks();

    // Verify the query specifically filters out deleted tasks
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    expect(findManyCall?.where?.deleted).toBe(false);

    vi.useRealTimers();
  });

  test("should set workflowCompletedAt when halting tasks", async () => {
    // Set current time
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const twentyFiveHoursAgo = new Date(now);
    twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

    const staleTasks = [
      {
        id: "task-1",
        title: "Task 1",
        workspaceId: "workspace-1",
        workflowStartedAt: twentyFiveHoursAgo,
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(staleTasks as any);
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);

    await haltStaleAgentTasks();

    // Verify the update includes workflowCompletedAt
    const updateCall = vi.mocked(mockDb.task.update).mock.calls[0][0];
    expect(updateCall?.data).toEqual({
      workflowStatus: "HALTED",
      workflowCompletedAt: expect.any(Date),
    });

    vi.useRealTimers();
  });
});

describe("haltTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should update task to HALTED status", async () => {
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);

    await haltTask("task-123");

    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: "task-123" },
      data: {
        workflowStatus: "HALTED",
        workflowCompletedAt: expect.any(Date),
      },
    });
  });
});
