import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    workspace: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock releaseTaskPod
vi.mock("@/lib/pods", () => ({
  releaseTaskPod: vi.fn(),
}));

const { db: mockDb } = await import("@/lib/db");
const { releaseTaskPod: mockReleaseTaskPod } = await import("@/lib/pods");
const { releaseStaleTaskPods, haltTask } = await import("@/services/task-coordinator-cron");

describe("releaseStaleTaskPods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  test("should find and release pods from tasks that have been stale for more than 24 hours", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const twentyFiveHoursAgo = new Date(now);
    twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

    const staleTasks = [
      {
        id: "task-1",
        title: "Stale Task 1",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-1",
        status: "IN_PROGRESS",
        workflowStatus: "IN_PROGRESS",
      },
      {
        id: "task-2",
        title: "Stale Task 2",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-2",
        status: "IN_PROGRESS",
        workflowStatus: "IN_PROGRESS",
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(staleTasks as any);
    vi.mocked(mockReleaseTaskPod).mockResolvedValue({
      success: true,
      podDropped: true,
      taskCleared: true,
    });

    const result = await releaseStaleTaskPods();

    // Verify the query was made correctly - queries for tasks with podId OR stale IN_PROGRESS
    expect(mockDb.task.findMany).toHaveBeenCalledWith({
      where: {
        updatedAt: {
          lt: expect.any(Date),
        },
        deleted: false,
        OR: [
          { podId: { not: null } },
          { status: "IN_PROGRESS", workflowStatus: { not: "HALTED" } },
        ],
      },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        updatedAt: true,
        podId: true,
        status: true,
        workflowStatus: true,
      },
    });

    // Verify releaseTaskPod was called for each task
    expect(mockReleaseTaskPod).toHaveBeenCalledTimes(2);
    expect(mockReleaseTaskPod).toHaveBeenCalledWith({
      taskId: "task-1",
      podId: "pod-1",
      workspaceId: "workspace-1",
      verifyOwnership: true,
      resetRepositories: false,
      clearTaskFields: true,
      newWorkflowStatus: "HALTED",
    });

    // Verify result
    expect(result.success).toBe(true);
    expect(result.podsReleased).toBe(2);
    expect(result.tasksHalted).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.timestamp).toBeDefined();

    vi.useRealTimers();
  });

  test("should not change workflowStatus for tasks that are not IN_PROGRESS", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const twentyFiveHoursAgo = new Date(now);
    twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

    const staleTasks = [
      {
        id: "task-1",
        title: "Completed Task with leaked pod",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-1",
        status: "DONE",
        workflowStatus: "COMPLETED",
      },
      {
        id: "task-2",
        title: "Failed Task with leaked pod",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-2",
        status: "DONE",
        workflowStatus: "FAILED",
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(staleTasks as any);
    vi.mocked(mockReleaseTaskPod).mockResolvedValue({
      success: true,
      podDropped: true,
      taskCleared: true,
    });

    const result = await releaseStaleTaskPods();

    // Verify releaseTaskPod was called with null for newWorkflowStatus (preserve original)
    expect(mockReleaseTaskPod).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        newWorkflowStatus: null,
      })
    );
    expect(mockReleaseTaskPod).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-2",
        newWorkflowStatus: null,
      })
    );

    // Verify result - pods released but no tasks halted (they weren't IN_PROGRESS)
    expect(result.success).toBe(true);
    expect(result.podsReleased).toBe(2);
    expect(result.tasksHalted).toBe(0);

    vi.useRealTimers();
  });

  test("should return empty results when no stale tasks found", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    const result = await releaseStaleTaskPods();

    expect(mockReleaseTaskPod).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.podsReleased).toBe(0);
    expect(result.tasksHalted).toBe(0);
    expect(result.errors).toEqual([]);

    vi.useRealTimers();
  });

  test("should handle errors from releaseTaskPod gracefully", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const twentyFiveHoursAgo = new Date(now);
    twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

    const staleTasks = [
      {
        id: "task-1",
        title: "Task 1",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-1",
        status: "IN_PROGRESS",
        workflowStatus: "IN_PROGRESS",
      },
      {
        id: "task-2",
        title: "Task 2",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-2",
        status: "IN_PROGRESS",
        workflowStatus: "IN_PROGRESS",
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(staleTasks as any);

    // First succeeds, second fails
    vi.mocked(mockReleaseTaskPod)
      .mockResolvedValueOnce({ success: true, podDropped: true, taskCleared: true })
      .mockResolvedValueOnce({ success: false, podDropped: false, taskCleared: false, error: "Pool API error" });

    const result = await releaseStaleTaskPods();

    expect(result.success).toBe(false);
    expect(result.podsReleased).toBe(1);
    expect(result.tasksHalted).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      taskId: "task-2",
      error: "Pool API error",
    });

    vi.useRealTimers();
  });

  test("should handle critical errors during execution", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(mockDb.task.findMany).mockRejectedValue(new Error("Database connection failed"));

    const result = await releaseStaleTaskPods();

    expect(result.success).toBe(false);
    expect(result.podsReleased).toBe(0);
    expect(result.tasksHalted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      taskId: "SYSTEM",
      error: "Critical execution error: Database connection failed",
    });

    vi.useRealTimers();
  });

  test("should target tasks with podId OR stale IN_PROGRESS without pod", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await releaseStaleTaskPods();

    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    // Should use OR clause to find both:
    // 1. Tasks with pods (any status)
    // 2. Stale IN_PROGRESS tasks without pods
    expect(findManyCall?.where?.OR).toEqual([
      { podId: { not: null } },
      { status: "IN_PROGRESS", workflowStatus: { not: "HALTED" } },
    ]);

    vi.useRealTimers();
  });

  test("should halt stale IN_PROGRESS tasks without pods", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const twentyFiveHoursAgo = new Date(now);
    twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

    const staleTasks = [
      {
        id: "task-1",
        title: "Stale IN_PROGRESS task without pod",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: null, // No pod
        status: "IN_PROGRESS",
        workflowStatus: "PENDING",
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(staleTasks as any);
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);

    const result = await releaseStaleTaskPods();

    // Should NOT call releaseTaskPod (no pod to release)
    expect(mockReleaseTaskPod).not.toHaveBeenCalled();

    // Should call haltTask via db.task.update
    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        workflowStatus: "HALTED",
        workflowCompletedAt: expect.any(Date),
      },
    });

    // Verify result
    expect(result.success).toBe(true);
    expect(result.podsReleased).toBe(0);
    expect(result.tasksHalted).toBe(1);

    vi.useRealTimers();
  });

  test("should not target deleted tasks", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await releaseStaleTaskPods();

    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    expect(findManyCall?.where?.deleted).toBe(false);

    vi.useRealTimers();
  });

  test("should use updatedAt to detect stale tasks", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await releaseStaleTaskPods();

    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    expect(findManyCall?.where?.updatedAt).toBeDefined();
    expect(findManyCall?.where?.updatedAt?.lt).toBeInstanceOf(Date);

    vi.useRealTimers();
  });

  test("should handle reassigned pods correctly", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const twentyFiveHoursAgo = new Date(now);
    twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

    const staleTasks = [
      {
        id: "task-1",
        title: "Task with reassigned pod",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-1",
        status: "IN_PROGRESS",
        workflowStatus: "IN_PROGRESS",
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(staleTasks as any);
    vi.mocked(mockReleaseTaskPod).mockResolvedValue({
      success: true,
      podDropped: false,
      taskCleared: true,
      reassigned: true,
    });

    const result = await releaseStaleTaskPods();

    // Pod wasn't dropped (reassigned) but task was cleared
    expect(result.success).toBe(true);
    expect(result.podsReleased).toBe(0);
    expect(result.tasksHalted).toBe(1);

    vi.useRealTimers();
  });

  test("should respect STALE_TASK_HOURS environment variable", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    // Set custom threshold
    vi.stubEnv("STALE_TASK_HOURS", "48");

    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await releaseStaleTaskPods();

    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    const threshold = findManyCall?.where?.updatedAt?.lt as Date;

    // Should be 48 hours ago
    const expectedThreshold = new Date(now);
    expectedThreshold.setHours(expectedThreshold.getHours() - 48);

    expect(threshold.getTime()).toBe(expectedThreshold.getTime());

    vi.unstubAllEnvs();
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

  test("should clear pod fields when clearPodFields is true", async () => {
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);

    await haltTask("task-123", true);

    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: "task-123" },
      data: {
        workflowStatus: "HALTED",
        workflowCompletedAt: expect.any(Date),
        podId: null,
        agentUrl: null,
        agentPassword: null,
      },
    });
  });

  test("should not clear pod fields when clearPodFields is false", async () => {
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);

    await haltTask("task-123", false);

    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: "task-123" },
      data: {
        workflowStatus: "HALTED",
        workflowCompletedAt: expect.any(Date),
      },
    });
  });
});
