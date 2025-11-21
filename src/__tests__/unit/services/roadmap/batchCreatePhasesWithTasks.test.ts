import { describe, test, expect, beforeEach, vi } from "vitest";
import { batchCreatePhasesWithTasks } from "@/services/roadmap/phases";
import { db } from "@/lib/db";

// Mock dependencies
vi.mock("@/lib/db");
vi.mock("@/services/roadmap/utils", () => ({
  validateFeatureAccess: vi.fn(),
  validatePhaseAccess: vi.fn(),
  calculateNextOrder: vi.fn(),
}));
vi.mock("@/lib/bounty-code", () => ({
  ensureUniqueBountyCode: vi.fn(),
}));

import { validateFeatureAccess } from "@/services/roadmap/utils";
import { ensureUniqueBountyCode } from "@/lib/bounty-code";

const mockedDb = vi.mocked(db);
const mockedValidateFeatureAccess = vi.mocked(validateFeatureAccess);
const mockedEnsureUniqueBountyCode = vi.mocked(ensureUniqueBountyCode);

describe("batchCreatePhasesWithTasks - Unit Tests", () => {
  const mockFeatureId = "feature-123";
  const mockUserId = "user-456";
  const mockWorkspaceId = "workspace-789";

  const mockFeature = {
    id: mockFeatureId,
    title: "Test Feature",
    workspaceId: mockWorkspaceId,
    createdById: mockUserId,
    updatedById: mockUserId,
    workspace: {
      id: mockWorkspaceId,
      name: "Test Workspace",
      deleted: false,
    },
  };

  const mockUser = {
    id: mockUserId,
    name: "Test User",
    email: "test@example.com",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock implementations
    mockedValidateFeatureAccess.mockResolvedValue(mockFeature as any);
    mockedEnsureUniqueBountyCode.mockResolvedValue("BOUNTY-TEST");

    // Mock db.$transaction and model methods
    Object.assign(db, {
      $transaction: vi.fn(async (callback: any) => {
        return await callback(mockedDb);
      }),
      user: {
        findUnique: vi.fn().mockResolvedValue(mockUser as any),
      },
      phase: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      task: {
        create: vi.fn(),
      },
    });
  });

  describe("Successful Creation", () => {
    test("creates single phase with tasks correctly", async () => {
      const phases = [
        {
          name: "Phase 1",
          description: "Test phase",
          tasks: [
            {
              title: "Task 1",
              description: "First task",
              priority: "HIGH" as const,
              tempId: "T1",
              dependsOn: [],
            },
            {
              title: "Task 2",
              description: "Second task",
              priority: "MEDIUM" as const,
              tempId: "T2",
              dependsOn: ["T1"],
            },
          ],
        },
      ];

      // Mock phase creation
      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        name: "Phase 1",
        description: "Test phase",
        status: "ACTIVE",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 2 },
      } as any);

      // Mock task creations
      mockedDb.task.create
        .mockResolvedValueOnce({
          id: "task-1",
          title: "Task 1",
          description: "First task",
          status: "TODO",
          priority: "HIGH",
          order: 0,
          featureId: mockFeatureId,
          phaseId: "phase-1",
          bountyCode: "BOUNTY-TEST",
          dependsOnTaskIds: [],
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: "phase-1", name: "Phase 1" },
        } as any)
        .mockResolvedValueOnce({
          id: "task-2",
          title: "Task 2",
          description: "Second task",
          status: "TODO",
          priority: "MEDIUM",
          order: 1,
          featureId: mockFeatureId,
          phaseId: "phase-1",
          bountyCode: "BOUNTY-TEST",
          dependsOnTaskIds: ["task-1"],
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: "phase-1", name: "Phase 1" },
        } as any);

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      // Verify result structure
      expect(result).toHaveLength(1);
      expect(result[0].phase.name).toBe("Phase 1");
      expect(result[0].tasks).toHaveLength(2);
      expect(result[0].tasks[0].title).toBe("Task 1");
      expect(result[0].tasks[1].title).toBe("Task 2");

      // Verify validateFeatureAccess was called
      expect(mockedValidateFeatureAccess).toHaveBeenCalledWith(mockFeatureId, mockUserId);

      // Verify user lookup
      expect(mockedDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUserId },
      });

      // Verify phase creation
      expect(mockedDb.phase.create).toHaveBeenCalledWith({
        data: {
          name: "Phase 1",
          description: "Test phase",
          featureId: mockFeatureId,
          order: 0,
        },
        select: expect.any(Object),
      });

      // Verify task creations
      expect(mockedDb.task.create).toHaveBeenCalledTimes(2);
    });

    test("creates multiple phases with correct ordering", async () => {
      const phases = [
        {
          name: "Setup",
          tasks: [{ title: "Task 1", priority: "HIGH" as const, tempId: "T1", dependsOn: [] }],
        },
        {
          name: "Build",
          tasks: [{ title: "Task 2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] }],
        },
        {
          name: "Deploy",
          tasks: [{ title: "Task 3", priority: "LOW" as const, tempId: "T3", dependsOn: [] }],
        },
      ];

      // Mock phase creations with correct order
      mockedDb.phase.create
        .mockResolvedValueOnce({
          id: "phase-1",
          name: "Setup",
          order: 0,
          featureId: mockFeatureId,
          _count: { tasks: 1 },
        } as any)
        .mockResolvedValueOnce({
          id: "phase-2",
          name: "Build",
          order: 1,
          featureId: mockFeatureId,
          _count: { tasks: 1 },
        } as any)
        .mockResolvedValueOnce({
          id: "phase-3",
          name: "Deploy",
          order: 2,
          featureId: mockFeatureId,
          _count: { tasks: 1 },
        } as any);

      // Mock task creations
      mockedDb.task.create
        .mockResolvedValueOnce({
          id: "task-1",
          title: "Task 1",
          phaseId: "phase-1",
          order: 0,
          dependsOnTaskIds: [],
        } as any)
        .mockResolvedValueOnce({
          id: "task-2",
          title: "Task 2",
          phaseId: "phase-2",
          order: 0,
          dependsOnTaskIds: [],
        } as any)
        .mockResolvedValueOnce({
          id: "task-3",
          title: "Task 3",
          phaseId: "phase-3",
          order: 0,
          dependsOnTaskIds: [],
        } as any);

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(result).toHaveLength(3);
      expect(result[0].phase.name).toBe("Setup");
      expect(result[0].phase.order).toBe(0);
      expect(result[1].phase.name).toBe("Build");
      expect(result[1].phase.order).toBe(1);
      expect(result[2].phase.name).toBe("Deploy");
      expect(result[2].phase.order).toBe(2);
    });

    test("appends to existing phases with correct order", async () => {
      // Mock existing phases
      mockedDb.phase.findMany.mockResolvedValueOnce([{ order: 2 }] as any);

      const phases = [
        {
          name: "New Phase",
          tasks: [{ title: "Task 1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-new",
        name: "New Phase",
        order: 3,
        featureId: mockFeatureId,
        _count: { tasks: 1 },
      } as any);

      mockedDb.task.create.mockResolvedValueOnce({
        id: "task-1",
        title: "Task 1",
        order: 0,
        dependsOnTaskIds: [],
      } as any);

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(result[0].phase.order).toBe(3);
      expect(mockedDb.phase.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          order: 3,
        }),
        select: expect.any(Object),
      });
    });

    test("sets correct task fields", async () => {
      const phases = [
        {
          name: "Phase 1",
          description: "Test phase",
          tasks: [
            {
              title: "Critical Task",
              description: "Detailed description",
              priority: "CRITICAL" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        name: "Phase 1",
        order: 0,
        _count: { tasks: 1 },
      } as any);

      mockedDb.task.create.mockResolvedValueOnce({
        id: "task-1",
        title: "Critical Task",
        description: "Detailed description",
        priority: "CRITICAL",
        status: "TODO",
        order: 0,
        bountyCode: "BOUNTY-TEST",
        dependsOnTaskIds: [],
      } as any);

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(mockedDb.task.create).toHaveBeenCalledWith({
        data: {
          title: "Critical Task",
          description: "Detailed description",
          workspaceId: mockWorkspaceId,
          featureId: mockFeatureId,
          phaseId: "phase-1",
          priority: "CRITICAL",
          status: "TODO",
          order: 0,
          bountyCode: "BOUNTY-TEST",
          dependsOnTaskIds: [],
          createdById: mockUserId,
          updatedById: mockUserId,
        },
        select: expect.any(Object),
      });

      expect(result[0].tasks[0].status).toBe("TODO");
      expect(result[0].tasks[0].priority).toBe("CRITICAL");
    });
  });

  describe("Dependency Mapping", () => {
    test("maps tempId to real ID for single dependency", async () => {
      const phases = [
        {
          name: "Phase 1",
          tasks: [
            { title: "Task A", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] },
            { title: "Task B", priority: "MEDIUM" as const, tempId: "T2", dependsOn: ["T1"] },
          ],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        order: 0,
        _count: { tasks: 2 },
      } as any);

      // Task 1 creates with real ID
      mockedDb.task.create
        .mockResolvedValueOnce({
          id: "real-task-1-id",
          title: "Task A",
          order: 0,
          dependsOnTaskIds: [],
        } as any)
        // Task 2 should have Task 1's real ID in dependencies
        .mockResolvedValueOnce({
          id: "real-task-2-id",
          title: "Task B",
          order: 1,
          dependsOnTaskIds: ["real-task-1-id"],
        } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      // Verify Task 2 was created with real dependency ID
      expect(mockedDb.task.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          title: "Task B",
          dependsOnTaskIds: ["real-task-1-id"],
        }),
        select: expect.any(Object),
      });
    });

    test("maps tempId to real ID for multiple dependencies", async () => {
      const phases = [
        {
          name: "Phase 1",
          tasks: [
            { title: "Task A", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
            { title: "Task B", priority: "HIGH" as const, tempId: "T2", dependsOn: [] },
            { title: "Task C", priority: "MEDIUM" as const, tempId: "T3", dependsOn: ["T1", "T2"] },
          ],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        order: 0,
        _count: { tasks: 3 },
      } as any);

      mockedDb.task.create
        .mockResolvedValueOnce({
          id: "real-id-A",
          title: "Task A",
          order: 0,
          dependsOnTaskIds: [],
        } as any)
        .mockResolvedValueOnce({
          id: "real-id-B",
          title: "Task B",
          order: 1,
          dependsOnTaskIds: [],
        } as any)
        .mockResolvedValueOnce({
          id: "real-id-C",
          title: "Task C",
          order: 2,
          dependsOnTaskIds: ["real-id-A", "real-id-B"],
        } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      // Verify Task C has both dependencies mapped to real IDs
      expect(mockedDb.task.create).toHaveBeenNthCalledWith(3, {
        data: expect.objectContaining({
          title: "Task C",
          dependsOnTaskIds: ["real-id-A", "real-id-B"],
        }),
        select: expect.any(Object),
      });
    });

    test("handles cross-phase dependencies", async () => {
      const phases = [
        {
          name: "Setup",
          tasks: [{ title: "Database", priority: "HIGH" as const, tempId: "T1", dependsOn: [] }],
        },
        {
          name: "Features",
          tasks: [{ title: "Feature X", priority: "MEDIUM" as const, tempId: "T5", dependsOn: ["T1"] }],
        },
      ];

      mockedDb.phase.create
        .mockResolvedValueOnce({
          id: "phase-1",
          order: 0,
          _count: { tasks: 1 },
        } as any)
        .mockResolvedValueOnce({
          id: "phase-2",
          order: 1,
          _count: { tasks: 1 },
        } as any);

      mockedDb.task.create
        .mockResolvedValueOnce({
          id: "cross-phase-task-1",
          title: "Database",
          phaseId: "phase-1",
          dependsOnTaskIds: [],
        } as any)
        .mockResolvedValueOnce({
          id: "cross-phase-task-5",
          title: "Feature X",
          phaseId: "phase-2",
          dependsOnTaskIds: ["cross-phase-task-1"],
        } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      // Verify Phase 2 task depends on Phase 1 task (cross-phase)
      expect(mockedDb.task.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          title: "Feature X",
          phaseId: "phase-2",
          dependsOnTaskIds: ["cross-phase-task-1"],
        }),
        select: expect.any(Object),
      });
    });

    test("handles empty dependsOn array", async () => {
      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Independent Task", priority: "LOW" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        order: 0,
        _count: { tasks: 1 },
      } as any);

      mockedDb.task.create.mockResolvedValueOnce({
        id: "task-1",
        title: "Independent Task",
        dependsOnTaskIds: [],
      } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(mockedDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          dependsOnTaskIds: [],
        }),
        select: expect.any(Object),
      });
    });

    test("handles undefined dependsOn (optional field)", async () => {
      const phases = [
        {
          name: "Phase 1",
          tasks: [
            { title: "Task", priority: "MEDIUM" as const, tempId: "T1" }, // No dependsOn field
          ],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        order: 0,
        _count: { tasks: 1 },
      } as any);

      mockedDb.task.create.mockResolvedValueOnce({
        id: "task-1",
        title: "Task",
        dependsOnTaskIds: [],
      } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      // Should default to empty array
      expect(mockedDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          dependsOnTaskIds: [],
        }),
        select: expect.any(Object),
      });
    });
  });

  describe("Task Ordering", () => {
    test("assigns correct order to tasks within phase", async () => {
      const phases = [
        {
          name: "Phase 1",
          tasks: [
            { title: "First", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
            { title: "Second", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] },
            { title: "Third", priority: "LOW" as const, tempId: "T3", dependsOn: [] },
          ],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        order: 0,
        _count: { tasks: 3 },
      } as any);

      mockedDb.task.create
        .mockResolvedValueOnce({ id: "task-1", order: 0 } as any)
        .mockResolvedValueOnce({ id: "task-2", order: 1 } as any)
        .mockResolvedValueOnce({ id: "task-3", order: 2 } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(mockedDb.task.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({ order: 0 }),
        select: expect.any(Object),
      });
      expect(mockedDb.task.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({ order: 1 }),
        select: expect.any(Object),
      });
      expect(mockedDb.task.create).toHaveBeenNthCalledWith(3, {
        data: expect.objectContaining({ order: 2 }),
        select: expect.any(Object),
      });
    });

    test("assigns correct phaseId to tasks", async () => {
      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "P1 Task", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
        {
          name: "Phase 2",
          tasks: [{ title: "P2 Task", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] }],
        },
      ];

      mockedDb.phase.create
        .mockResolvedValueOnce({
          id: "phase-1-id",
          name: "Phase 1",
          _count: { tasks: 1 },
        } as any)
        .mockResolvedValueOnce({
          id: "phase-2-id",
          name: "Phase 2",
          _count: { tasks: 1 },
        } as any);

      mockedDb.task.create
        .mockResolvedValueOnce({ id: "task-1", phaseId: "phase-1-id" } as any)
        .mockResolvedValueOnce({ id: "task-2", phaseId: "phase-2-id" } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(mockedDb.task.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          phaseId: "phase-1-id",
        }),
        select: expect.any(Object),
      });
      expect(mockedDb.task.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          phaseId: "phase-2-id",
        }),
        select: expect.any(Object),
      });
    });
  });

  describe("Error Handling", () => {
    test("throws error when feature access is denied", async () => {
      mockedValidateFeatureAccess.mockRejectedValueOnce(new Error("Access denied"));

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      await expect(batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases)).rejects.toThrow("Access denied");

      expect(mockedValidateFeatureAccess).toHaveBeenCalledWith(mockFeatureId, mockUserId);
      expect(mockedDb.$transaction).not.toHaveBeenCalled();
    });

    test("throws error when feature not found", async () => {
      mockedValidateFeatureAccess.mockRejectedValueOnce(new Error("Feature not found"));

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      await expect(batchCreatePhasesWithTasks("non-existent-feature-id", mockUserId, phases)).rejects.toThrow(
        "Feature not found",
      );

      expect(mockedDb.$transaction).not.toHaveBeenCalled();
    });

    test("throws error when user not found", async () => {
      mockedDb.user.findUnique.mockResolvedValueOnce(null);

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      await expect(batchCreatePhasesWithTasks(mockFeatureId, "non-existent-user-id", phases)).rejects.toThrow(
        "User not found",
      );

      expect(mockedDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: "non-existent-user-id" },
      });
    });

    test("handles database errors gracefully", async () => {
      mockedDb.phase.create.mockRejectedValueOnce(new Error("Database connection failed"));

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      await expect(batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases)).rejects.toThrow(
        "Database connection failed",
      );
    });
  });

  describe("Transaction Behavior", () => {
    test("uses transaction for atomicity", async () => {
      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        order: 0,
        _count: { tasks: 1 },
      } as any);

      mockedDb.task.create.mockResolvedValueOnce({
        id: "task-1",
        title: "Task 1",
        dependsOnTaskIds: [],
      } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      // Verify transaction was used
      expect(mockedDb.$transaction).toHaveBeenCalledTimes(1);
      expect(mockedDb.$transaction).toHaveBeenCalledWith(expect.any(Function));
    });

    test("transaction rollback on error", async () => {
      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        order: 0,
        _count: { tasks: 1 },
      } as any);

      // Task creation fails
      mockedDb.task.create.mockRejectedValueOnce(new Error("Task creation failed"));

      await expect(batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases)).rejects.toThrow(
        "Task creation failed",
      );

      // Transaction was attempted but failed
      expect(mockedDb.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe("Bounty Code Generation", () => {
    test("generates unique bounty codes for each task", async () => {
      const phases = [
        {
          name: "Phase 1",
          tasks: [
            { title: "Task 1", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
            { title: "Task 2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: [] },
          ],
        },
      ];

      mockedEnsureUniqueBountyCode.mockResolvedValueOnce("BOUNTY-001").mockResolvedValueOnce("BOUNTY-002");

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        order: 0,
        _count: { tasks: 2 },
      } as any);

      mockedDb.task.create
        .mockResolvedValueOnce({
          id: "task-1",
          bountyCode: "BOUNTY-001",
          dependsOnTaskIds: [],
        } as any)
        .mockResolvedValueOnce({
          id: "task-2",
          bountyCode: "BOUNTY-002",
          dependsOnTaskIds: [],
        } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(mockedEnsureUniqueBountyCode).toHaveBeenCalledTimes(2);
      expect(mockedDb.task.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          bountyCode: "BOUNTY-001",
        }),
        select: expect.any(Object),
      });
      expect(mockedDb.task.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          bountyCode: "BOUNTY-002",
        }),
        select: expect.any(Object),
      });
    });
  });

  describe("Input Validation", () => {
    test("trims whitespace from phase name", async () => {
      const phases = [
        {
          name: "  Phase with spaces  ",
          tasks: [{ title: "Task 1", priority: "MEDIUM" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        name: "Phase with spaces",
        order: 0,
        _count: { tasks: 1 },
      } as any);

      mockedDb.task.create.mockResolvedValueOnce({
        id: "task-1",
        dependsOnTaskIds: [],
      } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(mockedDb.phase.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: "Phase with spaces",
        }),
        select: expect.any(Object),
      });
    });

    test("trims whitespace from task title and description", async () => {
      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "  Task Title  ",
              description: "  Task Description  ",
              priority: "MEDIUM" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        order: 0,
        _count: { tasks: 1 },
      } as any);

      mockedDb.task.create.mockResolvedValueOnce({
        id: "task-1",
        title: "Task Title",
        description: "Task Description",
        dependsOnTaskIds: [],
      } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(mockedDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "Task Title",
          description: "Task Description",
        }),
        select: expect.any(Object),
      });
    });

    test("handles null/empty description", async () => {
      const phases = [
        {
          name: "Phase 1",
          description: "",
          tasks: [
            {
              title: "Task 1",
              description: "",
              priority: "MEDIUM" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      mockedDb.phase.create.mockResolvedValueOnce({
        id: "phase-1",
        description: null,
        order: 0,
        _count: { tasks: 1 },
      } as any);

      mockedDb.task.create.mockResolvedValueOnce({
        id: "task-1",
        description: null,
        dependsOnTaskIds: [],
      } as any);

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(mockedDb.phase.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: null,
        }),
        select: expect.any(Object),
      });

      expect(mockedDb.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: null,
        }),
        select: expect.any(Object),
      });
    });
  });
});
