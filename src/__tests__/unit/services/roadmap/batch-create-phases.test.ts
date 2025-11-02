import { describe, test, expect, vi, beforeEach } from "vitest";
import type { PhaseListItem } from "@/types/roadmap";

// Mock all external dependencies BEFORE imports
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
    phase: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    task: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/services/roadmap/utils");
vi.mock("@/lib/bounty-code");

// Import after mocks
import { batchCreatePhasesWithTasks } from "@/services/roadmap/phases";
import { db } from "@/lib/db";
import { validateFeatureAccess } from "@/services/roadmap/utils";
import { ensureUniqueBountyCode } from "@/lib/bounty-code";

// Test Data Factory
const TestDataFactory = {
  createValidPhaseInput: (overrides = {}) => ({
    name: "Test Phase",
    description: "Test Description",
    tasks: [
      {
        title: "Task 1",
        description: "Task 1 description",
        priority: "HIGH" as const,
        tempId: "T1",
        dependsOn: [],
      },
    ],
    ...overrides,
  }),

  createValidTaskInput: (overrides = {}) => ({
    title: "Test Task",
    description: "Task description",
    priority: "MEDIUM" as const,
    tempId: "T1",
    dependsOn: [],
    ...overrides,
  }),

  createMockUser: (overrides = {}) => ({
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
    image: null,
    role: "USER" as const,
    timezone: "UTC",
    locale: "en",
    createdAt: new Date(),
    updatedAt: new Date(),
    deleted: false,
    deletedAt: null,
    lastLoginAt: new Date(),
    poolApiKey: null,
    ...overrides,
  }),

  createMockFeature: (overrides = {}) => ({
    id: "feature-123",
    title: "Test Feature",
    workspaceId: "workspace-123",
    ...overrides,
  }),

  createMockPhase: (overrides = {}): PhaseListItem => ({
    id: `phase-${Math.random().toString(36).substr(2, 9)}`,
    name: "Test Phase",
    description: "Test Description",
    status: "NOT_STARTED" as const,
    order: 0,
    featureId: "feature-123",
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { tasks: 0 },
    ...overrides,
  }),

  createMockTask: (overrides = {}) => ({
    id: `task-${Math.random().toString(36).substr(2, 9)}`,
    title: "Test Task",
    description: "Task description",
    status: "TODO" as const,
    priority: "MEDIUM" as const,
    order: 0,
    featureId: "feature-123",
    phaseId: "phase-123",
    bountyCode: `BOUNTY-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    dependsOnTaskIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    systemAssigneeType: null,
    assignee: null,
    phase: {
      id: "phase-123",
      name: "Test Phase",
    },
    ...overrides,
  }),

  createTransactionContext: () => {
    const phaseFindMany = vi.fn();
    const phaseCreate = vi.fn();
    const taskCreate = vi.fn();
    
    return {
      phase: { 
        findMany: phaseFindMany, 
        create: phaseCreate 
      },
      task: { 
        create: taskCreate 
      },
      // Expose for easy access in tests
      phaseFindMany,
      phaseCreate,
      taskCreate,
    };
  },
};

// Test Helpers
const TestHelpers = {
  setupSuccessfulMocks: (options: {
    userId?: string;
    featureId?: string;
    existingPhases?: number;
    tasksPerPhase?: number;
  } = {}) => {
    const {
      userId = "user-123",
      featureId = "feature-123",
      existingPhases = 0,
      tasksPerPhase = 1,
    } = options;

    const mockUser = TestDataFactory.createMockUser({ id: userId });
    const mockFeature = TestDataFactory.createMockFeature({ id: featureId });

    // Mock validateFeatureAccess to return feature
    vi.mocked(validateFeatureAccess).mockResolvedValue(mockFeature);

    // Mock user lookup
    vi.mocked(db.user.findUnique).mockResolvedValue(mockUser);

    // Setup transaction mock
    const txContext = TestDataFactory.createTransactionContext();

    // Mock existing phases for order calculation
    if (existingPhases > 0) {
      txContext.phaseFindMany.mockResolvedValue([
        { order: existingPhases - 1 },
      ]);
    } else {
      txContext.phaseFindMany.mockResolvedValue([]);
    }

    // Mock phase creation
    let phaseCounter = 0;
    txContext.phaseCreate.mockImplementation(async (args: any) => {
      phaseCounter++;
      return TestDataFactory.createMockPhase({
        id: `phase-${phaseCounter}`,
        name: args.data.name,
        description: args.data.description,
        order: args.data.order,
        featureId: args.data.featureId,
      });
    });

    // Mock task creation
    let taskCounter = 0;
    txContext.taskCreate.mockImplementation(async (args: any) => {
      taskCounter++;
      return TestDataFactory.createMockTask({
        id: `task-${taskCounter}`,
        title: args.data.title,
        description: args.data.description,
        priority: args.data.priority,
        order: args.data.order,
        phaseId: args.data.phaseId,
        featureId: args.data.featureId,
        bountyCode: args.data.bountyCode,
        dependsOnTaskIds: args.data.dependsOnTaskIds,
      });
    });

    // Mock bounty code generation
    let bountyCounter = 0;
    vi.mocked(ensureUniqueBountyCode).mockImplementation(async () => {
      bountyCounter++;
      return `BOUNTY-${bountyCounter.toString().padStart(3, "0")}`;
    });

    // Mock transaction
    vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
      return callback(txContext);
    });

    return { mockUser, mockFeature, txContext };
  },

  expectAccessDeniedError: async (promise: Promise<any>) => {
    await expect(promise).rejects.toThrow("Feature not found or access denied");
  },

  expectUserNotFoundError: async (promise: Promise<any>) => {
    await expect(promise).rejects.toThrow("User not found");
  },

  expectBountyCodeError: async (promise: Promise<any>) => {
    await expect(promise).rejects.toThrow(
      "Failed to generate unique bounty code after maximum retries"
    );
  },
};

// Mock Setup
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
  },

  setupAccessDenied: () => {
    vi.mocked(validateFeatureAccess).mockRejectedValue(
      new Error("Feature not found or access denied")
    );
  },

  setupUserNotFound: () => {
    vi.mocked(validateFeatureAccess).mockResolvedValue(
      TestDataFactory.createMockFeature()
    );
    vi.mocked(db.user.findUnique).mockResolvedValue(null);
  },

  setupBountyCodeFailure: () => {
    vi.mocked(ensureUniqueBountyCode).mockRejectedValue(
      new Error("Failed to generate unique bounty code after maximum retries")
    );
  },
};

describe("batchCreatePhasesWithTasks - Unit Tests", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  describe("Input Validation", () => {
    test("should handle empty phases array", async () => {
      TestHelpers.setupSuccessfulMocks();

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        []
      );

      expect(result).toEqual([]);
      expect(db.$transaction).toHaveBeenCalled();
    });

    test("should handle phases with no tasks", async () => {
      TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Empty Phase",
          description: "Phase with no tasks",
          tasks: [],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      expect(result).toHaveLength(1);
      expect(result[0].tasks).toHaveLength(0);
    });

    test("should trim whitespace from phase and task names", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "  Phase with spaces  ",
          description: "  Description with spaces  ",
          tasks: [
            {
              title: "  Task with spaces  ",
              description: "  Task description  ",
              priority: "MEDIUM" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      await batchCreatePhasesWithTasks("feature-123", "user-123", phases);

      expect(txContext.phaseCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Phase with spaces",
            description: "Description with spaces",
          }),
        })
      );

      expect(txContext.taskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Task with spaces",
            description: "Task description",
          }),
        })
      );
    });

    test("should handle null descriptions", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase without description",
          tasks: [
            {
              title: "Task without description",
              priority: "LOW" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      await batchCreatePhasesWithTasks("feature-123", "user-123", phases);

      expect(txContext.phaseCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: null,
          }),
        })
      );

      expect(txContext.taskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: null,
          }),
        })
      );
    });
  });

  describe("Dependency Mapping Logic", () => {
    test("should map tempId to real task ID correctly", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Task 1",
              priority: "HIGH" as const,
              tempId: "T1",
              dependsOn: [],
            },
            {
              title: "Task 2",
              priority: "MEDIUM" as const,
              tempId: "T2",
              dependsOn: ["T1"],
            },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      // Verify T2 depends on T1's real ID, not tempId
      const task2 = result[0].tasks[1];
      expect(task2.dependsOnTaskIds).toContain(result[0].tasks[0].id);
      expect(task2.dependsOnTaskIds).not.toContain("T1");
    });

    test("should handle cross-phase dependencies", async () => {
      TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Task 1",
              priority: "HIGH" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
        {
          name: "Phase 2",
          tasks: [
            {
              title: "Task 2",
              priority: "MEDIUM" as const,
              tempId: "T2",
              dependsOn: ["T1"],
            },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      // Task 2 in Phase 2 should depend on Task 1 from Phase 1
      const task2 = result[1].tasks[0];
      const task1Id = result[0].tasks[0].id;
      expect(task2.dependsOnTaskIds).toContain(task1Id);
    });

    test("should handle multiple dependencies", async () => {
      TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Task 1",
              priority: "HIGH" as const,
              tempId: "T1",
              dependsOn: [],
            },
            {
              title: "Task 2",
              priority: "MEDIUM" as const,
              tempId: "T2",
              dependsOn: [],
            },
            {
              title: "Task 3",
              priority: "LOW" as const,
              tempId: "T3",
              dependsOn: ["T1", "T2"],
            },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      // Task 3 should depend on both Task 1 and Task 2
      const task3 = result[0].tasks[2];
      expect(task3.dependsOnTaskIds).toHaveLength(2);
      expect(task3.dependsOnTaskIds).toContain(result[0].tasks[0].id);
      expect(task3.dependsOnTaskIds).toContain(result[0].tasks[1].id);
    });

    test("should handle empty dependsOn arrays", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Independent Task",
              priority: "MEDIUM" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      await batchCreatePhasesWithTasks("feature-123", "user-123", phases);

      expect(txContext.taskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dependsOnTaskIds: [],
          }),
        })
      );
    });

    test("should handle missing dependsOn property", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Task without dependsOn",
              priority: "MEDIUM" as const,
              tempId: "T1",
            },
          ],
        },
      ];

      await batchCreatePhasesWithTasks("feature-123", "user-123", phases);

      expect(txContext.taskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dependsOnTaskIds: [],
          }),
        })
      );
    });
  });

  describe("Access Control", () => {
    test("should throw error when feature not found", async () => {
      MockSetup.setupAccessDenied();

      await TestHelpers.expectAccessDeniedError(
        batchCreatePhasesWithTasks("invalid-feature", "user-123", [])
      );

      expect(validateFeatureAccess).toHaveBeenCalledWith(
        "invalid-feature",
        "user-123"
      );
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    test("should throw error when user lacks access", async () => {
      MockSetup.setupAccessDenied();

      await TestHelpers.expectAccessDeniedError(
        batchCreatePhasesWithTasks("feature-123", "unauthorized-user", [])
      );

      expect(validateFeatureAccess).toHaveBeenCalledWith(
        "feature-123",
        "unauthorized-user"
      );
    });

    test("should throw error when user not found", async () => {
      MockSetup.setupUserNotFound();

      await TestHelpers.expectUserNotFoundError(
        batchCreatePhasesWithTasks("feature-123", "nonexistent-user", [])
      );

      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { id: "nonexistent-user" },
      });
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    test("should validate feature access before user lookup", async () => {
      MockSetup.setupAccessDenied();

      await TestHelpers.expectAccessDeniedError(
        batchCreatePhasesWithTasks("feature-123", "user-123", [])
      );

      expect(validateFeatureAccess).toHaveBeenCalled();
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("Transaction Behavior", () => {
    test("should calculate correct order when no existing phases", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks({
        existingPhases: 0,
      });

      const phases = [
        { name: "Phase 1", tasks: [] },
        { name: "Phase 2", tasks: [] },
      ];

      await batchCreatePhasesWithTasks("feature-123", "user-123", phases);

      // First phase should have order 0
      expect(txContext.phaseCreate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({ order: 0 }),
        })
      );

      // Second phase should have order 1
      expect(txContext.phaseCreate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({ order: 1 }),
        })
      );
    });

    test("should append phases after existing phases", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks({
        existingPhases: 3,
      });

      const phases = [
        { name: "Phase 4", tasks: [] },
        { name: "Phase 5", tasks: [] },
      ];

      await batchCreatePhasesWithTasks("feature-123", "user-123", phases);

      // Mock returns order 2 for last existing phase, so new phases start at 3
      expect(txContext.phaseCreate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({ order: 3 }),
        })
      );

      expect(txContext.phaseCreate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({ order: 4 }),
        })
      );
    });

    test("should assign sequential order to tasks within phase", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Task 1",
              priority: "HIGH" as const,
              tempId: "T1",
              dependsOn: [],
            },
            {
              title: "Task 2",
              priority: "MEDIUM" as const,
              tempId: "T2",
              dependsOn: [],
            },
            {
              title: "Task 3",
              priority: "LOW" as const,
              tempId: "T3",
              dependsOn: [],
            },
          ],
        },
      ];

      await batchCreatePhasesWithTasks("feature-123", "user-123", phases);

      expect(txContext.taskCreate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({ order: 0 }),
        })
      );

      expect(txContext.taskCreate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({ order: 1 }),
        })
      );

      expect(txContext.taskCreate).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          data: expect.objectContaining({ order: 2 }),
        })
      );
    });

    test("should use transaction context for all database operations", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Task 1",
              priority: "MEDIUM" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      await batchCreatePhasesWithTasks("feature-123", "user-123", phases);

      // Verify transaction was used
      expect(db.$transaction).toHaveBeenCalledTimes(1);

      // Verify operations used transaction context
      expect(txContext.phaseFindMany).toHaveBeenCalled();
      expect(txContext.phaseCreate).toHaveBeenCalled();
      expect(txContext.taskCreate).toHaveBeenCalled();
    });

    test("should query existing phases with correct parameters", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks();

      await batchCreatePhasesWithTasks("feature-123", "user-123", [
        { name: "Phase 1", tasks: [] },
      ]);

      expect(txContext.phaseFindMany).toHaveBeenCalledWith({
        where: { featureId: "feature-123" },
        select: { order: true },
        orderBy: { order: "desc" },
        take: 1,
      });
    });
  });

  describe("Bounty Code Generation", () => {
    test("should generate unique bounty code for each task", async () => {
      TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Task 1",
              priority: "HIGH" as const,
              tempId: "T1",
              dependsOn: [],
            },
            {
              title: "Task 2",
              priority: "MEDIUM" as const,
              tempId: "T2",
              dependsOn: [],
            },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      expect(ensureUniqueBountyCode).toHaveBeenCalledTimes(2);
      expect(result[0].tasks[0].bountyCode).toBe("BOUNTY-001");
      expect(result[0].tasks[1].bountyCode).toBe("BOUNTY-002");
    });

    test("should propagate bounty code generation errors", async () => {
      TestHelpers.setupSuccessfulMocks();
      MockSetup.setupBountyCodeFailure();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Task 1",
              priority: "MEDIUM" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      await TestHelpers.expectBountyCodeError(
        batchCreatePhasesWithTasks("feature-123", "user-123", phases)
      );
    });
  });

  describe("Success Cases", () => {
    test("should create single phase with single task", async () => {
      TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          description: "First phase",
          tasks: [
            {
              title: "Task 1",
              description: "First task",
              priority: "HIGH" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      expect(result).toHaveLength(1);
      expect(result[0].phase.name).toBe("Phase 1");
      expect(result[0].tasks).toHaveLength(1);
      expect(result[0].tasks[0].title).toBe("Task 1");
    });

    test("should create multiple phases with multiple tasks", async () => {
      TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Task 1",
              priority: "HIGH" as const,
              tempId: "T1",
              dependsOn: [],
            },
            {
              title: "Task 2",
              priority: "MEDIUM" as const,
              tempId: "T2",
              dependsOn: [],
            },
          ],
        },
        {
          name: "Phase 2",
          tasks: [
            {
              title: "Task 3",
              priority: "LOW" as const,
              tempId: "T3",
              dependsOn: [],
            },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      expect(result).toHaveLength(2);
      expect(result[0].phase.name).toBe("Phase 1");
      expect(result[0].tasks).toHaveLength(2);
      expect(result[1].phase.name).toBe("Phase 2");
      expect(result[1].tasks).toHaveLength(1);
    });

    test("should handle complex dependency graph", async () => {
      TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Foundation",
          tasks: [
            {
              title: "Setup Database",
              priority: "CRITICAL" as const,
              tempId: "T1",
              dependsOn: [],
            },
            {
              title: "Setup API",
              priority: "CRITICAL" as const,
              tempId: "T2",
              dependsOn: ["T1"],
            },
          ],
        },
        {
          name: "Features",
          tasks: [
            {
              title: "User Auth",
              priority: "HIGH" as const,
              tempId: "T3",
              dependsOn: ["T2"],
            },
            {
              title: "User Profile",
              priority: "MEDIUM" as const,
              tempId: "T4",
              dependsOn: ["T3"],
            },
          ],
        },
        {
          name: "Polish",
          tasks: [
            {
              title: "UI Improvements",
              priority: "LOW" as const,
              tempId: "T5",
              dependsOn: ["T3", "T4"],
            },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      expect(result).toHaveLength(3);

      // Verify cross-phase dependencies
      const t3 = result[1].tasks[0]; // User Auth
      const t2Id = result[0].tasks[1].id; // Setup API
      expect(t3.dependsOnTaskIds).toContain(t2Id);

      const t5 = result[2].tasks[0]; // UI Improvements
      const t3Id = result[1].tasks[0].id; // User Auth
      const t4Id = result[1].tasks[1].id; // User Profile
      expect(t5.dependsOnTaskIds).toContain(t3Id);
      expect(t5.dependsOnTaskIds).toContain(t4Id);
    });

    test("should set correct audit fields on tasks", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks({
        userId: "auditor-123",
      });

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Task 1",
              priority: "MEDIUM" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      await batchCreatePhasesWithTasks("feature-123", "auditor-123", phases);

      expect(txContext.taskCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdById: "auditor-123",
            updatedById: "auditor-123",
          }),
        })
      );
    });

    test("should return structured result with phase metadata", async () => {
      TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Task 1",
              priority: "MEDIUM" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      // Verify result structure
      expect(result[0]).toHaveProperty("phase");
      expect(result[0]).toHaveProperty("tasks");
      expect(result[0].phase).toHaveProperty("id");
      expect(result[0].phase).toHaveProperty("name");
      expect(result[0].phase).toHaveProperty("status");
      expect(result[0].phase).toHaveProperty("_count");
    });
  });

  describe("Edge Cases", () => {
    test("should handle phases with only description, no tasks", async () => {
      TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Planning Phase",
          description: "This phase is for planning only",
          tasks: [],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      expect(result).toHaveLength(1);
      expect(result[0].phase.name).toBe("Planning Phase");
      expect(result[0].phase.description).toBe("This phase is for planning only");
      expect(result[0].tasks).toHaveLength(0);
    });

    test("should handle tasks with all priority levels", async () => {
      const { txContext } = TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Critical Task",
              priority: "CRITICAL" as const,
              tempId: "T1",
              dependsOn: [],
            },
            {
              title: "High Task",
              priority: "HIGH" as const,
              tempId: "T2",
              dependsOn: [],
            },
            {
              title: "Medium Task",
              priority: "MEDIUM" as const,
              tempId: "T3",
              dependsOn: [],
            },
            {
              title: "Low Task",
              priority: "LOW" as const,
              tempId: "T4",
              dependsOn: [],
            },
          ],
        },
      ];

      await batchCreatePhasesWithTasks("feature-123", "user-123", phases);

      expect(txContext.taskCreate).toHaveBeenCalledTimes(4);
      expect(txContext.taskCreate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({ priority: "CRITICAL" }),
        })
      );
      expect(txContext.taskCreate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({ priority: "HIGH" }),
        })
      );
      expect(txContext.taskCreate).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          data: expect.objectContaining({ priority: "MEDIUM" }),
        })
      );
      expect(txContext.taskCreate).toHaveBeenNthCalledWith(
        4,
        expect.objectContaining({
          data: expect.objectContaining({ priority: "LOW" }),
        })
      );
    });

    test("should handle very long dependency chains", async () => {
      TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Sequential Tasks",
          tasks: [
            {
              title: "Task 1",
              priority: "MEDIUM" as const,
              tempId: "T1",
              dependsOn: [],
            },
            {
              title: "Task 2",
              priority: "MEDIUM" as const,
              tempId: "T2",
              dependsOn: ["T1"],
            },
            {
              title: "Task 3",
              priority: "MEDIUM" as const,
              tempId: "T3",
              dependsOn: ["T2"],
            },
            {
              title: "Task 4",
              priority: "MEDIUM" as const,
              tempId: "T4",
              dependsOn: ["T3"],
            },
            {
              title: "Task 5",
              priority: "MEDIUM" as const,
              tempId: "T5",
              dependsOn: ["T4"],
            },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      // Verify each task depends on the previous one
      for (let i = 1; i < result[0].tasks.length; i++) {
        const currentTask = result[0].tasks[i];
        const previousTaskId = result[0].tasks[i - 1].id;
        expect(currentTask.dependsOnTaskIds).toContain(previousTaskId);
      }
    });

    test("should handle tasks depending on multiple tasks from different phases", async () => {
      TestHelpers.setupSuccessfulMocks();

      const phases = [
        {
          name: "Phase 1",
          tasks: [
            {
              title: "Backend Task",
              priority: "HIGH" as const,
              tempId: "T1",
              dependsOn: [],
            },
          ],
        },
        {
          name: "Phase 2",
          tasks: [
            {
              title: "Frontend Task",
              priority: "HIGH" as const,
              tempId: "T2",
              dependsOn: [],
            },
          ],
        },
        {
          name: "Phase 3",
          tasks: [
            {
              title: "Integration Task",
              priority: "CRITICAL" as const,
              tempId: "T3",
              dependsOn: ["T1", "T2"],
            },
          ],
        },
      ];

      const result = await batchCreatePhasesWithTasks(
        "feature-123",
        "user-123",
        phases
      );

      const integrationTask = result[2].tasks[0];
      const backendTaskId = result[0].tasks[0].id;
      const frontendTaskId = result[1].tasks[0].id;

      expect(integrationTask.dependsOnTaskIds).toHaveLength(2);
      expect(integrationTask.dependsOnTaskIds).toContain(backendTaskId);
      expect(integrationTask.dependsOnTaskIds).toContain(frontendTaskId);
    });
  });
});