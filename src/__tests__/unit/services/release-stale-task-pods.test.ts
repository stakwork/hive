import { describe, test, expect, vi, beforeEach } from "vitest";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
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

// Mock getPodDetails
vi.mock("@/lib/pods/queries", () => ({
  getPodDetails: vi.fn(),
}));

const { db: mockDb } = await import("@/lib/db");
const { releaseTaskPod: mockReleaseTaskPod } = await import("@/lib/pods");
const { getPodDetails: mockGetPodDetails } = await import("@/lib/pods/queries");
const { releaseStaleTaskPods, haltTask } = await import("@/services/task-coordinator-cron");

describe("releaseStaleTaskPods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default: findMany returns [] (covers both orphan sweep and stale sweep calls)
    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.task.updateMany).mockResolvedValue({ count: 0 } as any);
    // Default: getPodDetails returns a valid pod — orphan sweep skips all tasks by default.
    // Individual tests that need to exercise orphan clearing override this explicitly.
    vi.mocked(mockGetPodDetails).mockResolvedValue({
      podId: "some-pod",
      password: null,
      portMappings: null,
    });
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
        chatMessages: [],
      },
      {
        id: "task-2",
        title: "Stale Task 2",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-2",
        status: "IN_PROGRESS",
        workflowStatus: "IN_PROGRESS",
        chatMessages: [],
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
        chatMessages: {
          select: {
            artifacts: {
              where: { type: "PULL_REQUEST" },
              select: {
                content: true,
              },
            },
          },
        },
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
        chatMessages: [],
      },
      {
        id: "task-2",
        title: "Failed Task with leaked pod",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-2",
        status: "DONE",
        workflowStatus: "FAILED",
        chatMessages: [],
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
        chatMessages: [],
      },
      {
        id: "task-2",
        title: "Task 2",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-2",
        status: "IN_PROGRESS",
        workflowStatus: "IN_PROGRESS",
        chatMessages: [],
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

    // calls[0] is orphan sweep; calls[1] is limbo sweep; calls[2] is the stale sweep
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[2][0];
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
        agentPassword: null,
        status: "IN_PROGRESS",
        workflowStatus: "PENDING",
        chatMessages: [],
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
      select: {
        workflowStartedAt: true,
        workflowCompletedAt: true,
        featureId: true,
        workspace: { select: { slug: true } },
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

    // calls[0] is orphan sweep; calls[1] is limbo sweep; calls[2] is the stale sweep
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[2][0];
    expect(findManyCall?.where?.deleted).toBe(false);

    vi.useRealTimers();
  });

  test("should use updatedAt to detect stale tasks", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await releaseStaleTaskPods();

    // calls[0] is orphan sweep; calls[1] is limbo sweep; calls[2] is the stale sweep
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[2][0];
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
        chatMessages: [],
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

    // calls[0] is orphan sweep; calls[1] is limbo sweep; calls[2] is the stale sweep
    const findManyCall = vi.mocked(mockDb.task.findMany).mock.calls[2][0];
    const threshold = findManyCall?.where?.updatedAt?.lt as Date;

    // Should be 48 hours ago
    const expectedThreshold = new Date(now);
    expectedThreshold.setHours(expectedThreshold.getHours() - 48);

    expect(threshold.getTime()).toBe(expectedThreshold.getTime());

    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  test("should not halt tasks with open PRs but should still release pods", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const twentyFiveHoursAgo = new Date(now);
    twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

    const staleTasks = [
      {
        id: "task-1",
        title: "Task with open PR",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-1",
        status: "IN_PROGRESS",
        workflowStatus: "IN_PROGRESS",
        chatMessages: [
          {
            artifacts: [
              {
                content: { status: "OPEN", url: "https://github.com/org/repo/pull/1" },
              },
            ],
          },
        ],
      },
      {
        id: "task-2",
        title: "Task with merged PR",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: "pod-2",
        status: "IN_PROGRESS",
        workflowStatus: "IN_PROGRESS",
        chatMessages: [
          {
            artifacts: [
              {
                content: { status: "DONE", url: "https://github.com/org/repo/pull/2" },
              },
            ],
          },
        ],
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(staleTasks as any);
    vi.mocked(mockReleaseTaskPod).mockResolvedValue({
      success: true,
      podDropped: true,
      taskCleared: true,
    });

    const result = await releaseStaleTaskPods();

    // Verify releaseTaskPod was called for both tasks
    expect(mockReleaseTaskPod).toHaveBeenCalledTimes(2);

    // Task with open PR: pod released, but newWorkflowStatus is null (not halted)
    expect(mockReleaseTaskPod).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        newWorkflowStatus: null,
      })
    );

    // Task with merged PR: pod released and halted
    expect(mockReleaseTaskPod).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-2",
        newWorkflowStatus: "HALTED",
      })
    );

    // Verify result - only 1 task halted (the one with merged PR)
    expect(result.success).toBe(true);
    expect(result.podsReleased).toBe(2);
    expect(result.tasksHalted).toBe(1);

    vi.useRealTimers();
  });

  test("should not halt tasks with open PRs even without pods", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const twentyFiveHoursAgo = new Date(now);
    twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

    const staleTasks = [
      {
        id: "task-1",
        title: "Task with open PR but no pod",
        workspaceId: "workspace-1",
        updatedAt: twentyFiveHoursAgo,
        podId: null,
        agentPassword: null,
        status: "IN_PROGRESS",
        workflowStatus: "IN_PROGRESS",
        chatMessages: [
          {
            artifacts: [
              {
                content: { status: "OPEN", url: "https://github.com/org/repo/pull/1" },
              },
            ],
          },
        ],
      },
    ];

    vi.mocked(mockDb.task.findMany).mockResolvedValue(staleTasks as any);

    const result = await releaseStaleTaskPods();

    // Should NOT call releaseTaskPod (no pod to release)
    expect(mockReleaseTaskPod).not.toHaveBeenCalled();

    // Should NOT call haltTask (has open PR)
    expect(mockDb.task.update).not.toHaveBeenCalled();

    // Verify result - no pods released, no tasks halted
    expect(result.success).toBe(true);
    expect(result.podsReleased).toBe(0);
    expect(result.tasksHalted).toBe(0);

    vi.useRealTimers();
  });

  // ── Orphan sweep tests ──────────────────────────────────────────────────────

  test("should clear podId/agentPassword/agentUrl when getPodDetails returns null (soft-deleted pod)", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const tasksWithPod = [{ id: "task-orphan", podId: "deleted-pod-1" }];

    // First findMany (orphan sweep) returns a task with a pod
    vi.mocked(mockDb.task.findMany)
      .mockResolvedValueOnce(tasksWithPod as any) // orphan sweep
      .mockResolvedValueOnce([]); // stale sweep

    // getPodDetails returns null → pod is gone / soft-deleted
    vi.mocked(mockGetPodDetails).mockResolvedValue(null);
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);

    const result = await releaseStaleTaskPods();

    expect(mockGetPodDetails).toHaveBeenCalledWith("deleted-pod-1");
    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: "task-orphan" },
      data: { podId: null, agentPassword: null, agentUrl: null },
    });
    expect(result.orphanedPodsCleared).toBe(1);
    expect(result.success).toBe(true);

    vi.useRealTimers();
  });

  test("should NOT clear fields when getPodDetails returns a valid pod", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const tasksWithPod = [{ id: "task-healthy", podId: "healthy-pod-1" }];

    vi.mocked(mockDb.task.findMany)
      .mockResolvedValueOnce(tasksWithPod as any) // orphan sweep
      .mockResolvedValueOnce([]); // stale sweep

    // getPodDetails returns a real pod
    vi.mocked(mockGetPodDetails).mockResolvedValue({
      podId: "healthy-pod-1",
      password: "secret",
      portMappings: null,
    });

    const result = await releaseStaleTaskPods();

    expect(mockGetPodDetails).toHaveBeenCalledWith("healthy-pod-1");
    expect(mockDb.task.updateMany).not.toHaveBeenCalled();
    expect(result.orphanedPodsCleared).toBe(0);
    expect(result.success).toBe(true);

    vi.useRealTimers();
  });

  test("orphan sweep should not change workflowStatus", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const tasksWithPod = [{ id: "task-orphan-2", podId: "deleted-pod-2" }];

    vi.mocked(mockDb.task.findMany)
      .mockResolvedValueOnce(tasksWithPod as any)
      .mockResolvedValueOnce([]);

    vi.mocked(mockGetPodDetails).mockResolvedValue(null);
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);

    await releaseStaleTaskPods();

    // update should only touch pod fields — no workflowStatus change
    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: "task-orphan-2" },
      data: { podId: null, agentPassword: null, agentUrl: null },
    });
    const updateCall = vi.mocked(mockDb.task.update).mock.calls[0][0];
    expect(updateCall?.data).not.toHaveProperty("workflowStatus");

    vi.useRealTimers();
  });

  test("orphan sweep runs regardless of task age (not time-gated)", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const tasksWithPod = [{ id: "task-recent", podId: "orphan-pod-recent" }];

    vi.mocked(mockDb.task.findMany)
      .mockResolvedValueOnce(tasksWithPod as any)
      .mockResolvedValueOnce([]);

    vi.mocked(mockGetPodDetails).mockResolvedValue(null);
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);

    const result = await releaseStaleTaskPods();

    // The orphan sweep findMany call must NOT have an updatedAt filter
    const orphanSweepCall = vi.mocked(mockDb.task.findMany).mock.calls[0][0];
    expect(orphanSweepCall?.where).not.toHaveProperty("updatedAt");
    expect(orphanSweepCall?.where?.podId).toEqual({ not: null });
    expect(orphanSweepCall?.where?.deleted).toBe(false);
    expect(result.orphanedPodsCleared).toBe(1);

    vi.useRealTimers();
  });

  // ── Limbo sweep tests ───────────────────────────────────────────────────────

  test("should rescue limbo tasks (IN_PROGRESS + no stakworkProjectId) past the threshold", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const twentyFiveHoursAgo = new Date(now);
    twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

    const limboTask = {
      id: "limbo-task-1",
      title: "Stranded Task",
      updatedAt: twentyFiveHoursAgo,
    };

    // findMany calls in order:
    // 1. orphan sweep (tasksWithPods) → []
    // 2. limbo sweep → [limboTask]
    // 3. stale sweep → []
    vi.mocked(mockDb.task.findMany)
      .mockResolvedValueOnce([]) // orphan sweep
      .mockResolvedValueOnce([limboTask] as any) // limbo sweep
      .mockResolvedValueOnce([]); // stale sweep

    vi.mocked(mockDb.task.updateMany).mockResolvedValue({ count: 1 } as any);

    const result = await releaseStaleTaskPods();

    // Verify limbo updateMany was called correctly
    expect(mockDb.task.updateMany).toHaveBeenCalledWith({
      where: { id: "limbo-task-1", workflowStatus: "IN_PROGRESS", stakworkProjectId: null },
      data: { workflowStatus: "PENDING", workflowStartedAt: null },
    });

    expect(result.limboTasksRescued).toBe(1);
    expect(result.success).toBe(true);

    vi.useRealTimers();
  });

  test("should include limboTasksRescued: 0 in return when no limbo tasks exist", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    const result = await releaseStaleTaskPods();

    expect(result).toHaveProperty("limboTasksRescued");
    expect(result.limboTasksRescued).toBe(0);

    vi.useRealTimers();
  });

  test("should query limbo tasks with correct filters (IN_PROGRESS, no stakworkProjectId, not deleted, past threshold)", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);

    await releaseStaleTaskPods();

    // calls[0] = orphan sweep, calls[1] = limbo sweep, calls[2] = stale sweep
    const limboSweepCall = vi.mocked(mockDb.task.findMany).mock.calls[1][0];
    expect(limboSweepCall?.where).toMatchObject({
      workflowStatus: "IN_PROGRESS",
      stakworkProjectId: null,
      deleted: false,
      updatedAt: { lt: expect.any(Date) },
    });
    expect(limboSweepCall?.select).toMatchObject({
      id: true,
      title: true,
      updatedAt: true,
    });

    vi.useRealTimers();
  });

  test("should rescue multiple limbo tasks and count each one", async () => {
    const now = new Date("2024-10-24T12:00:00Z");
    vi.setSystemTime(now);

    const thirtyHoursAgo = new Date(now);
    thirtyHoursAgo.setHours(thirtyHoursAgo.getHours() - 30);

    const limboTasks = [
      { id: "limbo-1", title: "Task A", updatedAt: thirtyHoursAgo },
      { id: "limbo-2", title: "Task B", updatedAt: thirtyHoursAgo },
      { id: "limbo-3", title: "Task C", updatedAt: thirtyHoursAgo },
    ];

    vi.mocked(mockDb.task.findMany)
      .mockResolvedValueOnce([]) // orphan sweep
      .mockResolvedValueOnce(limboTasks as any) // limbo sweep
      .mockResolvedValueOnce([]); // stale sweep

    vi.mocked(mockDb.task.updateMany).mockResolvedValue({ count: 1 } as any);

    const result = await releaseStaleTaskPods();

    expect(mockDb.task.updateMany).toHaveBeenCalledTimes(3);
    expect(result.limboTasksRescued).toBe(3);
    expect(result.success).toBe(true);

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
      select: {
        workflowStartedAt: true,
        workflowCompletedAt: true,
        featureId: true,
        workspace: { select: { slug: true } },
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
      select: {
        workflowStartedAt: true,
        workflowCompletedAt: true,
        featureId: true,
        workspace: { select: { slug: true } },
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
      select: {
        workflowStartedAt: true,
        workflowCompletedAt: true,
        featureId: true,
        workspace: { select: { slug: true } },
      },
    });
  });
});
