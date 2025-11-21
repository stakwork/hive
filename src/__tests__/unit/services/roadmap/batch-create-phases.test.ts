import { describe, test, expect, vi, beforeEach } from "vitest";
import { batchCreatePhasesWithTasks } from "@/services/roadmap/phases";
import { dbMock } from "@/__tests__/support/mocks/prisma";

// Mock the helper modules
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

describe("batchCreatePhasesWithTasks - Unit Tests", () => {
  const mockUserId = "user-123";
  const mockFeatureId = "feature-456";
  const mockWorkspaceId = "workspace-789";

  const mockFeature = {
    id: mockFeatureId,
    workspaceId: mockWorkspaceId,
  };

  const mockUser = {
    id: mockUserId,
    name: "Test User",
    email: "test@example.com",
  };

  beforeEach(() => {
    // Reset all mocks (dbMock is automatically reset via unit.ts setup)
    vi.clearAllMocks();

    // Setup default mock implementations
    (validateFeatureAccess as any).mockResolvedValue(mockFeature);
    (ensureUniqueBountyCode as any).mockImplementation(() =>
      Promise.resolve(`BC-${Math.random().toString(36).substring(7)}`),
    );

    // Mock user lookup
    dbMock.user.findUnique.mockResolvedValue(mockUser);
  });

  describe("Access Control", () => {
    test("calls validateFeatureAccess with correct parameters", async () => {
      // Setup transaction mock
      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue({
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 0 },
      });

      const phases = [
        {
          name: "Phase 1",
          tasks: [],
        },
      ];

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(validateFeatureAccess).toHaveBeenCalledWith(mockFeatureId, mockUserId);
      expect(validateFeatureAccess).toHaveBeenCalledTimes(1);
    });

    test("throws error when validateFeatureAccess rejects", async () => {
      (validateFeatureAccess as any).mockRejectedValue(new Error("Access denied"));

      const phases = [{ name: "Phase 1", tasks: [] }];

      await expect(batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases)).rejects.toThrow("Access denied");
    });

    test("throws error when user is not found", async () => {
      dbMock.user.findUnique.mockResolvedValue(null);

      const phases = [{ name: "Phase 1", tasks: [] }];

      await expect(batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases)).rejects.toThrow("User not found");
    });
  });

  describe("Phase Creation", () => {
    test("creates single phase with correct data", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: "Test description",
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 0 },
      };

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);

      const phases = [
        {
          name: "Phase 1",
          description: "Test description",
          tasks: [],
        },
      ];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(dbMock.phase.create).toHaveBeenCalledWith({
        data: {
          name: "Phase 1",
          description: "Test description",
          featureId: mockFeatureId,
          order: 0,
        },
        select: expect.objectContaining({
          id: true,
          name: true,
          description: true,
          status: true,
          order: true,
          featureId: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: { tasks: true },
          },
        }),
      });

      expect(result).toHaveLength(1);
      expect(result[0].phase).toEqual(mockPhase);
    });

    test("creates multiple phases with correct ordering", async () => {
      let phaseIdCounter = 1;

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockImplementation((args: any) => {
        const phaseId = `phase-${phaseIdCounter++}`;
        return Promise.resolve({
          id: phaseId,
          name: args.data.name,
          description: args.data.description || null,
          status: "PLANNED",
          order: args.data.order,
          featureId: mockFeatureId,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { tasks: 0 },
        });
      });

      const phases = [
        { name: "Phase 1", tasks: [] },
        { name: "Phase 2", tasks: [] },
        { name: "Phase 3", tasks: [] },
      ];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(result).toHaveLength(3);
      expect(result[0].phase.order).toBe(0);
      expect(result[1].phase.order).toBe(1);
      expect(result[2].phase.order).toBe(2);
    });

    test("appends to existing phases with correct order", async () => {
      // Mock returns only the highest ordered phase (due to take: 1 and orderBy: order: desc)
      const existingPhases = [{ id: "existing-2", order: 1 }];

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue(existingPhases);
      dbMock.phase.create.mockResolvedValue({
        id: "phase-new",
        name: "New Phase",
        description: null,
        status: "PLANNED",
        order: 2,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 0 },
      });

      const phases = [{ name: "New Phase", tasks: [] }];

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(dbMock.phase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            order: 2, // Should start at 2 (existing max order 1 + 1)
          }),
        }),
      );
    });

    test("trims phase name before creation", async () => {
      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue({
        id: "phase-1",
        name: "Trimmed Phase",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 0 },
      });

      const phases = [
        {
          name: "  Trimmed Phase  ",
          tasks: [],
        },
      ];

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(dbMock.phase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Trimmed Phase",
          }),
        }),
      );
    });
  });

  describe("Task Creation", () => {
    test("creates tasks with correct data and ordering", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 2 },
      };

      let taskIdCounter = 1;
      const createdTasks: any[] = [];

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) => {
        const task = {
          id: `task-${taskIdCounter++}`,
          title: args.data.title,
          description: args.data.description || null,
          status: args.data.status,
          priority: args.data.priority,
          order: args.data.order,
          featureId: args.data.featureId,
          phaseId: args.data.phaseId,
          workspaceId: args.data.workspaceId,
          bountyCode: args.data.bountyCode,
          dependsOnTaskIds: args.data.dependsOnTaskIds || [],
          createdById: args.data.createdById,
          updatedById: args.data.updatedById,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        };
        createdTasks.push(task);
        return Promise.resolve(task);
      });

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            { title: "Task 1", priority: "HIGH" as const, tempId: "T1" },
            { title: "Task 2", priority: "MEDIUM" as const, tempId: "T2" },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(result[0].tasks).toHaveLength(2);
      expect(result[0].tasks[0].order).toBe(0);
      expect(result[0].tasks[1].order).toBe(1);
      expect(result[0].tasks[0].phaseId).toBe(mockPhase.id);
      expect(result[0].tasks[1].phaseId).toBe(mockPhase.id);
    });

    test("calls ensureUniqueBountyCode for each task", async () => {
      (ensureUniqueBountyCode as any).mockResolvedValueOnce("BC-111").mockResolvedValueOnce("BC-222");

      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 2 },
      };

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: `task-${Date.now()}`,
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        }),
      );

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            { title: "Task 1", priority: "HIGH" as const, tempId: "T1" },
            { title: "Task 2", priority: "MEDIUM" as const, tempId: "T2" },
          ],
        },
      ];

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(ensureUniqueBountyCode).toHaveBeenCalledTimes(2);
    });

    test("trims task title and description before creation", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 1 },
      };

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: "task-1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        }),
      );

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "  Trimmed Task  ",
              description: "  Trimmed Description  ",
              priority: "HIGH" as const,
              tempId: "T1",
            },
          ],
        },
      ];

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(dbMock.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Trimmed Task",
            description: "Trimmed Description",
          }),
        }),
      );
    });

    test("sets task status to TODO by default", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 1 },
      };

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: "task-1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        }),
      );

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "HIGH" as const, tempId: "T1" }],
        },
      ];

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(dbMock.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "TODO",
          }),
        }),
      );
    });
  });

  describe("Dependency Mapping", () => {
    test("maps tempId to real task ID correctly", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 2 },
      };

      const createdTaskIds: string[] = [];

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) => {
        const taskId = `task-${createdTaskIds.length + 1}`;
        createdTaskIds.push(taskId);
        return Promise.resolve({
          id: taskId,
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        });
      });

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            { title: "Task 1", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
            { title: "Task 2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: ["T1"] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      // Task 2 should have Task 1's real ID in its dependencies
      expect(result[0].tasks[1].dependsOnTaskIds).toEqual([result[0].tasks[0].id]);
      expect(result[0].tasks[1].dependsOnTaskIds).not.toContain("T1");
    });

    test("handles multiple dependencies correctly", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 3 },
      };

      const createdTaskIds: string[] = [];

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) => {
        const taskId = `task-${createdTaskIds.length + 1}`;
        createdTaskIds.push(taskId);
        return Promise.resolve({
          id: taskId,
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        });
      });

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            { title: "Task 1", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
            { title: "Task 2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: ["T1"] },
            { title: "Task 3", priority: "LOW" as const, tempId: "T3", dependsOn: ["T1", "T2"] },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      // Task 3 should depend on both Task 1 and Task 2
      expect(result[0].tasks[2].dependsOnTaskIds).toHaveLength(2);
      expect(result[0].tasks[2].dependsOnTaskIds).toContain(result[0].tasks[0].id);
      expect(result[0].tasks[2].dependsOnTaskIds).toContain(result[0].tasks[1].id);
    });

    test("handles cross-phase dependencies", async () => {
      let phaseIdCounter = 1;
      let taskIdCounter = 1;

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockImplementation((args: any) => {
        const phaseId = `phase-${phaseIdCounter++}`;
        return Promise.resolve({
          id: phaseId,
          name: args.data.name,
          description: null,
          status: "PLANNED",
          order: args.data.order,
          featureId: mockFeatureId,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { tasks: 1 },
        });
      });
      dbMock.task.create.mockImplementation((args: any) => {
        const taskId = `task-${taskIdCounter++}`;
        return Promise.resolve({
          id: taskId,
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: args.data.phaseId, name: "Phase" },
        });
      });

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "HIGH" as const, tempId: "T1", dependsOn: [] }],
        },
        {
          name: "Phase 2",
          tasks: [{ title: "Task 2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: ["T1"] }],
        },
      ];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      // Task 2 in Phase 2 should depend on Task 1 from Phase 1
      expect(result[1].tasks[0].dependsOnTaskIds).toEqual([result[0].tasks[0].id]);
    });

    test("handles empty dependsOn array", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 1 },
      };

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: "task-1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        }),
      );

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "HIGH" as const, tempId: "T1", dependsOn: [] }],
        },
      ];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(result[0].tasks[0].dependsOnTaskIds).toEqual([]);
    });

    test("handles undefined dependsOn", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 1 },
      };

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: "task-1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        }),
      );

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "HIGH" as const, tempId: "T1" }],
        },
      ];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(result[0].tasks[0].dependsOnTaskIds).toEqual([]);
    });
  });

  describe("Transaction Handling", () => {
    test("wraps operations in transaction", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 0 },
      };

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);

      const phases = [{ name: "Phase 1", tasks: [] }];

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
      expect(dbMock.$transaction).toHaveBeenCalledWith(expect.any(Function));
    });

    test("uses transaction context for all database operations", async () => {
      let capturedTx: any;

      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 1 },
      };

      dbMock.$transaction.mockImplementation((callback: any) => {
        capturedTx = dbMock;
        return callback(dbMock);
      });
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: "task-1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        }),
      );

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "HIGH" as const, tempId: "T1" }],
        },
      ];

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      // Verify all database calls were made with the transaction context
      expect(capturedTx).toBeDefined();
      expect(dbMock.phase.findMany).toHaveBeenCalled();
      expect(dbMock.phase.create).toHaveBeenCalled();
      expect(dbMock.task.create).toHaveBeenCalled();
    });
  });

  describe("Return Value", () => {
    test("returns array of phases with tasks", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 1 },
      };

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: "task-1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        }),
      );

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "HIGH" as const, tempId: "T1" }],
        },
      ];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty("phase");
      expect(result[0]).toHaveProperty("tasks");
      expect(result[0].phase).toEqual(mockPhase);
      expect(result[0].tasks).toHaveLength(1);
    });

    test("updates _count.tasks on phase", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 0 }, // Initially 0
      };

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: `task-${Date.now()}`,
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        }),
      );

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            { title: "Task 1", priority: "HIGH" as const, tempId: "T1" },
            { title: "Task 2", priority: "MEDIUM" as const, tempId: "T2" },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      // The function should update _count.tasks to match the created tasks
      expect(result[0].phase._count.tasks).toBe(2);
    });
  });

  describe("Edge Cases", () => {
    test("handles phase with no tasks", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Empty Phase",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 0 },
      };

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);

      const phases = [{ name: "Empty Phase", tasks: [] }];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(result).toHaveLength(1);
      expect(result[0].tasks).toHaveLength(0);
      expect(result[0].phase._count.tasks).toBe(0);
    });

    test("handles empty description fields", async () => {
      const mockPhase = {
        id: "phase-1",
        name: "Phase 1",
        description: null,
        status: "PLANNED",
        order: 0,
        featureId: mockFeatureId,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { tasks: 1 },
      };

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockResolvedValue(mockPhase);
      dbMock.task.create.mockImplementation((args: any) =>
        Promise.resolve({
          id: "task-1",
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: mockPhase.id, name: mockPhase.name },
        }),
      );

      const phases = [
        {
          name: "Phase 1",
          tasks: [{ title: "Task 1", priority: "HIGH" as const, tempId: "T1" }],
        },
      ];

      await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(dbMock.phase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: null,
          }),
        }),
      );

      expect(dbMock.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: null,
          }),
        }),
      );
    });

    test("handles complex multi-phase scenario with mixed dependencies", async () => {
      let phaseIdCounter = 1;
      let taskIdCounter = 1;

      dbMock.$transaction.mockImplementation((callback: any) => callback(dbMock));
      dbMock.phase.findMany.mockResolvedValue([]);
      dbMock.phase.create.mockImplementation((args: any) => {
        const phaseId = `phase-${phaseIdCounter++}`;
        return Promise.resolve({
          id: phaseId,
          name: args.data.name,
          description: args.data.description || null,
          status: "PLANNED",
          order: args.data.order,
          featureId: mockFeatureId,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { tasks: 0 },
        });
      });
      dbMock.task.create.mockImplementation((args: any) => {
        const taskId = `task-${taskIdCounter++}`;
        return Promise.resolve({
          id: taskId,
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
          systemAssigneeType: null,
          assignee: null,
          phase: { id: args.data.phaseId, name: "Phase" },
        });
      });

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            { title: "Task 1", priority: "HIGH" as const, tempId: "T1", dependsOn: [] },
            { title: "Task 2", priority: "MEDIUM" as const, tempId: "T2", dependsOn: ["T1"] },
          ],
        },
        {
          name: "Phase 2",
          tasks: [{ title: "Task 3", priority: "HIGH" as const, tempId: "T3", dependsOn: ["T1", "T2"] }],
        },
        {
          name: "Phase 3",
          tasks: [{ title: "Task 4", priority: "LOW" as const, tempId: "T4", dependsOn: ["T3"] }],
        },
      ];

      const result = await batchCreatePhasesWithTasks(mockFeatureId, mockUserId, phases);

      expect(result).toHaveLength(3);
      expect(result[0].tasks).toHaveLength(2);
      expect(result[1].tasks).toHaveLength(1);
      expect(result[2].tasks).toHaveLength(1);

      // Verify cross-phase dependencies
      const task3 = result[1].tasks[0];
      expect(task3.dependsOnTaskIds).toContain(result[0].tasks[0].id); // T1
      expect(task3.dependsOnTaskIds).toContain(result[0].tasks[1].id); // T2

      const task4 = result[2].tasks[0];
      expect(task4.dependsOnTaskIds).toContain(task3.id); // T3
    });
  });
});
