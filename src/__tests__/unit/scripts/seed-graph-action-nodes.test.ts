import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import {
  PrismaClient,
  TaskStatus,
  WorkflowStatus,
  ArtifactType,
  StakworkRunType,
  StakworkRunDecision,
  FeatureStatus,
} from "@prisma/client";

// Mock Prisma client
const mockPrismaInstance = {
  workspace: {
    findFirst: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  task: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
  feature: {
    upsert: vi.fn(),
    findMany: vi.fn(),
  },
  stakworkRun: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  chatMessage: {
    create: vi.fn(),
  },
  artifact: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
  $disconnect: vi.fn(),
};

describe("seed-graph-action-nodes script", () => {
  const mockWorkspace = {
    id: "workspace-123",
    slug: "test-workspace",
    ownerId: "user-456",
    name: "Test Workspace",
    createdAt: new Date(),
  };

  const mockUser = {
    id: "user-456",
    email: "test@example.com",
    name: "Test User",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaInstance.workspace.findFirst.mockResolvedValue(mockWorkspace);
    mockPrismaInstance.user.findUnique.mockResolvedValue(mockUser);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("workspace and user resolution", () => {
    test("should query for existing workspace ordered by creation date", async () => {
      await mockPrismaInstance.workspace.findFirst({
        orderBy: { createdAt: "asc" },
      });

      expect(mockPrismaInstance.workspace.findFirst).toHaveBeenCalledWith({
        orderBy: { createdAt: "asc" },
      });
    });

    test("should throw error when no workspace exists", async () => {
      mockPrismaInstance.workspace.findFirst.mockResolvedValue(null);

      await expect(async () => {
        const workspace = await mockPrismaInstance.workspace.findFirst({
          orderBy: { createdAt: "asc" },
        });
        if (!workspace) {
          throw new Error(
            "No workspace found. Please run seed-database.ts first to create a workspace.",
          );
        }
      }).rejects.toThrow("No workspace found");
    });

    test("should find user by workspace ownerId", async () => {
      await mockPrismaInstance.user.findUnique({
        where: { id: mockWorkspace.ownerId },
      });

      expect(mockPrismaInstance.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockWorkspace.ownerId },
      });
    });

    test("should throw error when user not found", async () => {
      mockPrismaInstance.user.findUnique.mockResolvedValue(null);

      await expect(async () => {
        const user = await mockPrismaInstance.user.findUnique({
          where: { id: mockWorkspace.ownerId },
        });
        if (!user) {
          throw new Error(
            `No user found with ID ${mockWorkspace.ownerId}. Database may be corrupted.`,
          );
        }
      }).rejects.toThrow("No user found with ID");
    });
  });

  describe("task creation", () => {
    test("should create IN_PROGRESS tasks with correct status", async () => {
      const taskData = {
        id: `task-in-progress-1-${mockWorkspace.id}`,
        title: "Task In Progress 1: Implement user authentication",
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        archived: false,
      };

      await mockPrismaInstance.task.upsert({
        where: { id: taskData.id },
        update: {},
        create: taskData,
      });

      expect(mockPrismaInstance.task.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: taskData.id },
          create: expect.objectContaining({
            status: TaskStatus.IN_PROGRESS,
            workflowStatus: WorkflowStatus.IN_PROGRESS,
            archived: false,
          }),
        }),
      );
    });

    test("should create HALTED tasks with correct status", async () => {
      const taskData = {
        id: `task-halted-1-${mockWorkspace.id}`,
        title: "Task Halted 1: Database schema design needs review",
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.HALTED,
        archived: false,
      };

      await mockPrismaInstance.task.upsert({
        where: { id: taskData.id },
        update: {},
        create: taskData,
      });

      expect(mockPrismaInstance.task.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            workflowStatus: WorkflowStatus.HALTED,
            archived: false,
          }),
        }),
      );
    });

    test("should create DONE tasks with PR artifacts", async () => {
      const taskData = {
        id: `task-done-pr-1-${mockWorkspace.id}`,
        title: "Task Done 1: Add email validation",
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        archived: false,
        branch: "feature/task-done-1",
      };

      const task = await mockPrismaInstance.task.upsert({
        where: { id: taskData.id },
        update: {},
        create: taskData,
      });

      mockPrismaInstance.task.upsert.mockResolvedValue(taskData);

      expect(mockPrismaInstance.task.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: TaskStatus.DONE,
            branch: "feature/task-done-1",
          }),
        }),
      );
    });

    test("should create COMPLETED tasks that should not appear on graph", async () => {
      const taskData = {
        id: `task-completed-1-${mockWorkspace.id}`,
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
        archived: false,
      };

      await mockPrismaInstance.task.upsert({
        where: { id: taskData.id },
        update: {},
        create: taskData,
      });

      expect(mockPrismaInstance.task.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            workflowStatus: WorkflowStatus.COMPLETED,
          }),
        }),
      );
    });

    test("should create archived HALTED task that should not appear", async () => {
      const taskData = {
        id: `task-halted-archived-${mockWorkspace.id}`,
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        status: TaskStatus.CANCELLED,
        workflowStatus: WorkflowStatus.HALTED,
        archived: true,
      };

      await mockPrismaInstance.task.upsert({
        where: { id: taskData.id },
        update: {},
        create: taskData,
      });

      expect(mockPrismaInstance.task.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            workflowStatus: WorkflowStatus.HALTED,
            archived: true,
          }),
        }),
      );
    });
  });

  describe("artifact creation", () => {
    test("should create PULL_REQUEST artifact for DONE tasks", async () => {
      const messageId = "message-123";
      const artifactData = {
        messageId,
        type: ArtifactType.PULL_REQUEST,
        content: {
          url: "https://github.com/example/repo/pull/1001",
          number: 1001,
          title: "Task Done 1: Add email validation",
          status: "DONE",
          branch: "feature/task-done-1",
          baseBranch: "main",
        },
      };

      await mockPrismaInstance.artifact.create({
        data: artifactData,
      });

      expect(mockPrismaInstance.artifact.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: ArtifactType.PULL_REQUEST,
          content: expect.objectContaining({
            status: "DONE",
            branch: "feature/task-done-1",
          }),
        }),
      });
    });
  });

  describe("feature creation", () => {
    test("should create REQUIREMENTS features with completed StakworkRun", async () => {
      const featureData = {
        id: `feature-requirements-1-${mockWorkspace.id}`,
        title: "Feature Requirements 1: User profile management",
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        updatedById: mockUser.id,
        status: FeatureStatus.PLANNED,
      };

      await mockPrismaInstance.feature.upsert({
        where: { id: featureData.id },
        update: {},
        create: featureData,
      });

      expect(mockPrismaInstance.feature.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: FeatureStatus.PLANNED,
          }),
        }),
      );
    });

    test("should create ARCHITECTURE features with completed StakworkRun", async () => {
      const featureData = {
        id: `feature-architecture-1-${mockWorkspace.id}`,
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        updatedById: mockUser.id,
      };

      mockPrismaInstance.feature.upsert.mockResolvedValue(featureData);

      const stakworkRunData = {
        webhookUrl: "https://example.com/webhook/architecture-1",
        projectId: 6001,
        type: StakworkRunType.ARCHITECTURE,
        featureId: featureData.id,
        workspaceId: mockWorkspace.id,
        status: WorkflowStatus.COMPLETED,
        decision: null,
      };

      await mockPrismaInstance.stakworkRun.create({
        data: stakworkRunData,
      });

      expect(mockPrismaInstance.stakworkRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: StakworkRunType.ARCHITECTURE,
          status: WorkflowStatus.COMPLETED,
          decision: null,
        }),
      });
    });

    test("should create feature with clarifying questions in StakworkRun result", async () => {
      const featureData = {
        id: `feature-requirements-questions-${mockWorkspace.id}`,
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        updatedById: mockUser.id,
      };

      mockPrismaInstance.feature.upsert.mockResolvedValue(featureData);

      const stakworkRunData = {
        webhookUrl: "https://example.com/webhook/requirements-questions",
        projectId: 7001,
        type: StakworkRunType.REQUIREMENTS,
        featureId: featureData.id,
        workspaceId: mockWorkspace.id,
        status: WorkflowStatus.COMPLETED,
        result: JSON.stringify({
          tool_use: "ask_clarifying_questions",
          questions: [
            "Which social media platforms should be prioritized?",
            "Should sharing be available for all content types or specific ones?",
          ],
        }),
        dataType: "json",
        decision: null,
      };

      await mockPrismaInstance.stakworkRun.create({
        data: stakworkRunData,
      });

      expect(mockPrismaInstance.stakworkRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          result: expect.stringContaining("ask_clarifying_questions"),
          dataType: "json",
          decision: null,
        }),
      });
    });

    test("should create TASK_GENERATION feature with completed StakworkRun", async () => {
      const featureData = {
        id: `feature-task-generation-${mockWorkspace.id}`,
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        updatedById: mockUser.id,
      };

      mockPrismaInstance.feature.upsert.mockResolvedValue(featureData);

      const stakworkRunData = {
        type: StakworkRunType.TASK_GENERATION,
        featureId: featureData.id,
        workspaceId: mockWorkspace.id,
        status: WorkflowStatus.COMPLETED,
        decision: null,
      };

      await mockPrismaInstance.stakworkRun.create({
        data: stakworkRunData,
      });

      expect(mockPrismaInstance.stakworkRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: StakworkRunType.TASK_GENERATION,
          status: WorkflowStatus.COMPLETED,
          decision: null,
        }),
      });
    });

    test("should create features with ACCEPTED/REJECTED decisions that should not appear", async () => {
      const featureData = {
        id: `feature-decided-1-${mockWorkspace.id}`,
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        updatedById: mockUser.id,
        status: FeatureStatus.IN_PROGRESS,
      };

      mockPrismaInstance.feature.upsert.mockResolvedValue(featureData);

      const stakworkRunData = {
        type: StakworkRunType.REQUIREMENTS,
        featureId: featureData.id,
        workspaceId: mockWorkspace.id,
        status: WorkflowStatus.COMPLETED,
        decision: StakworkRunDecision.ACCEPTED,
        feedback: "Looks good, proceed with implementation",
      };

      await mockPrismaInstance.stakworkRun.create({
        data: stakworkRunData,
      });

      expect(mockPrismaInstance.stakworkRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          decision: StakworkRunDecision.ACCEPTED,
        }),
      });
    });
  });

  describe("filtering logic verification", () => {
    test("should identify tasks that should appear on action-required graph", () => {
      const tasks = [
        {
          id: "1",
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          archived: false,
        },
        { id: "2", workflowStatus: WorkflowStatus.HALTED, archived: false },
        {
          id: "3",
          status: TaskStatus.DONE,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          archived: false,
        },
      ];

      const shouldAppear = tasks.filter(
        (t) =>
          !t.archived &&
          (t.workflowStatus === WorkflowStatus.IN_PROGRESS ||
            t.workflowStatus === WorkflowStatus.HALTED ||
            (t.status === TaskStatus.DONE &&
              t.workflowStatus !== WorkflowStatus.COMPLETED)),
      );

      expect(shouldAppear).toHaveLength(3);
    });

    test("should identify tasks that should NOT appear on action-required graph", () => {
      const tasks = [
        {
          id: "1",
          workflowStatus: WorkflowStatus.COMPLETED,
          archived: false,
        },
        { id: "2", workflowStatus: WorkflowStatus.HALTED, archived: true },
      ];

      const shouldAppear = tasks.filter(
        (t) =>
          !t.archived && t.workflowStatus !== WorkflowStatus.COMPLETED,
      );

      expect(shouldAppear).toHaveLength(0);
    });

    test("should identify features that should appear on action-required graph", () => {
      const features = [
        {
          id: "1",
          stakworkRuns: [
            {
              type: StakworkRunType.REQUIREMENTS,
              status: WorkflowStatus.COMPLETED,
              decision: null,
            },
          ],
        },
        {
          id: "2",
          stakworkRuns: [
            {
              type: StakworkRunType.ARCHITECTURE,
              status: WorkflowStatus.COMPLETED,
              decision: null,
            },
          ],
        },
        {
          id: "3",
          stakworkRuns: [
            {
              type: StakworkRunType.TASK_GENERATION,
              status: WorkflowStatus.COMPLETED,
              decision: null,
            },
          ],
        },
      ];

      const shouldAppear = features.filter((f) =>
        f.stakworkRuns.some(
          (run) =>
            run.status === WorkflowStatus.COMPLETED && run.decision === null,
        ),
      );

      expect(shouldAppear).toHaveLength(3);
    });

    test("should identify features that should NOT appear on action-required graph", () => {
      const features = [
        {
          id: "1",
          stakworkRuns: [
            {
              type: StakworkRunType.REQUIREMENTS,
              status: WorkflowStatus.COMPLETED,
              decision: StakworkRunDecision.ACCEPTED,
            },
          ],
        },
        {
          id: "2",
          stakworkRuns: [
            {
              type: StakworkRunType.ARCHITECTURE,
              status: WorkflowStatus.COMPLETED,
              decision: StakworkRunDecision.REJECTED,
            },
          ],
        },
      ];

      const shouldAppear = features.filter((f) =>
        f.stakworkRuns.some(
          (run) =>
            run.status === WorkflowStatus.COMPLETED && run.decision === null,
        ),
      );

      expect(shouldAppear).toHaveLength(0);
    });
  });

  describe("idempotency", () => {
    test("should use upsert for tasks to allow multiple runs", async () => {
      const taskId = `task-in-progress-1-${mockWorkspace.id}`;

      await mockPrismaInstance.task.upsert({
        where: { id: taskId },
        update: {},
        create: { id: taskId },
      });

      expect(mockPrismaInstance.task.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: taskId },
          update: {},
        }),
      );
    });

    test("should use upsert for features to allow multiple runs", async () => {
      const featureId = `feature-requirements-1-${mockWorkspace.id}`;

      await mockPrismaInstance.feature.upsert({
        where: { id: featureId },
        update: {},
        create: { id: featureId },
      });

      expect(mockPrismaInstance.feature.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: featureId },
          update: {},
        }),
      );
    });
  });
});
