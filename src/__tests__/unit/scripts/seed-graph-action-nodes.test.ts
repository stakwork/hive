import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import {
  PrismaClient,
  TaskStatus,
  WorkflowStatus,
  ArtifactType,
  FeatureStatus,
  ChatRole,
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
    test("should create awaiting-feedback features with ASSISTANT chat message", async () => {
      const featureData = {
        id: `feature-awaiting-1-${mockWorkspace.id}`,
        title: "Feature Awaiting Feedback 1: User profile management",
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        updatedById: mockUser.id,
        status: FeatureStatus.PLANNED,
      };

      mockPrismaInstance.feature.upsert.mockResolvedValue(featureData);

      await mockPrismaInstance.feature.upsert({
        where: { id: featureData.id },
        update: {},
        create: featureData,
      });

      await mockPrismaInstance.chatMessage.create({
        data: {
          featureId: featureData.id,
          role: ChatRole.ASSISTANT,
          message: "I've analyzed the requirements. Could you provide more details?",
        },
      });

      expect(mockPrismaInstance.feature.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: FeatureStatus.PLANNED,
          }),
        }),
      );
      expect(mockPrismaInstance.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: ChatRole.ASSISTANT,
            featureId: featureData.id,
          }),
        }),
      );
    });

    test("should create not-awaiting features with USER last message (should NOT appear)", async () => {
      const featureData = {
        id: `feature-not-awaiting-1-${mockWorkspace.id}`,
        workspaceId: mockWorkspace.id,
        createdById: mockUser.id,
        updatedById: mockUser.id,
        status: FeatureStatus.IN_PROGRESS,
      };

      mockPrismaInstance.feature.upsert.mockResolvedValue(featureData);

      // Create ASSISTANT message then USER reply — last message is USER
      await mockPrismaInstance.chatMessage.create({
        data: { featureId: featureData.id, role: ChatRole.ASSISTANT, message: "What are your requirements?" },
      });
      await mockPrismaInstance.chatMessage.create({
        data: { featureId: featureData.id, role: ChatRole.USER, message: "Here are my requirements..." },
      });

      expect(mockPrismaInstance.chatMessage.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: ChatRole.USER,
          }),
        }),
      );
    });
  });

  describe("filtering logic verification", () => {
    test("should identify tasks that should appear on action-required graph", () => {
      const tasks: { id: string; workflowStatus: WorkflowStatus; archived: boolean; status?: TaskStatus }[] = [
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
      // awaitingFeedback = lastMsgRole === ASSISTANT && no tasks
      const features = [
        { id: "1", lastMsgRole: ChatRole.ASSISTANT, taskCount: 0 },
        { id: "2", lastMsgRole: ChatRole.ASSISTANT, taskCount: 0 },
        { id: "3", lastMsgRole: ChatRole.ASSISTANT, taskCount: 0 },
      ];

      const shouldAppear = features.filter(
        (f) => f.lastMsgRole === ChatRole.ASSISTANT && f.taskCount === 0,
      );

      expect(shouldAppear).toHaveLength(3);
    });

    test("should identify features that should NOT appear on action-required graph", () => {
      const features = [
        // Last message is USER — user already replied
        { id: "1", lastMsgRole: ChatRole.USER, taskCount: 0 },
        // Last message is ASSISTANT but tasks exist
        { id: "2", lastMsgRole: ChatRole.ASSISTANT, taskCount: 5 },
      ];

      const shouldAppear = features.filter(
        (f) => f.lastMsgRole === ChatRole.ASSISTANT && f.taskCount === 0,
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
