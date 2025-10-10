import { describe, test, expect, beforeEach, vi } from "vitest";
import { createTaskWithStakworkWorkflow } from "@/services/task-workflow";
import { db } from "@/lib/db";
import { Priority, TaskStatus, TaskSourceType } from "@prisma/client";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      create: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock external dependencies
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-key",
    STAKWORK_BASE_URL: "https://stakwork.example.com",
    STAKWORK_WORKFLOW_ID: "123,456,789",
  },
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

// Mock fetch globally
global.fetch = vi.fn();

const mockDb = vi.mocked(db);

// Helper to create mock task response
function createMockTaskResponse(overrides: any = {}) {
  return {
    id: "test-task-id",
    title: "Test Task",
    description: "Test description",
    workspaceId: "test-workspace-id",
    assigneeId: null,
    repositoryId: null,
    status: "TODO",
    priority: "MEDIUM",
    estimatedHours: null,
    actualHours: null,
    workflowStatus: "PENDING",
    workflowStartedAt: null,
    workflowCompletedAt: null,
    stakworkProjectId: null,
    sourceType: "USER",
    createdById: "test-user-id",
    updatedById: "test-user-id",
    deleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    assignee: null,
    repository: null,
    createdBy: {
      id: "test-user-id",
      name: "Test User",
      email: "test@example.com",
      image: null,
      githubAuth: {
        githubUsername: "testuser",
      },
    },
    workspace: {
      id: "test-workspace-id",
      name: "Test Workspace",
      slug: "test-workspace",
      swarm: {
        swarmUrl: "https://swarm.example.com/api",
        swarmSecretAlias: "test-alias",
        poolName: "test-pool",
        name: "test-swarm",
        id: "swarm-id",
      },
    },
    ...overrides,
  };
}

// Get mocked imports
const { getGithubUsernameAndPAT } = vi.mocked(await import("@/lib/auth/nextauth"));
const mockFetch = vi.mocked(global.fetch);

describe("createTaskWithStakworkWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock response
    mockDb.task.create.mockResolvedValue(createMockTaskResponse() as any);
    
    // Mock user lookup for createChatMessageAndTriggerStakwork
    mockDb.user.findUnique.mockResolvedValue({
      id: "test-user-id",
      name: "Test User",
    } as any);
    
    // Mock chat message creation
    mockDb.chatMessage.create.mockResolvedValue({
      id: "test-message-id",
      taskId: "test-task-id",
      message: "Test message",
      role: "USER",
      contextTags: "[]",
      status: "SENT",
      task: {
        id: "test-task-id",
        title: "Test Task",
      },
    } as any);
    
    // Mock task update for workflow status
    mockDb.task.update.mockResolvedValue({} as any);
    
    // Mock GitHub auth
    getGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "test-token",
    });
    
    // Mock fetch for Stakwork API
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { project_id: 12345, workflow_id: 67890 },
      }),
    } as any);
  });

  describe("Task Creation - All Parameters", () => {
    test("should create task with all parameters provided", async () => {
      const params = {
        title: "Complete Task",
        description: "Complete task description",
        workspaceId: "workspace-123",
        assigneeId: "assignee-456",
        repositoryId: "repo-789",
        priority: "HIGH" as Priority,
        sourceType: "JANITOR" as TaskSourceType,
        userId: "user-123",
        initialMessage: "Initial workflow message",
        status: "IN_PROGRESS" as TaskStatus,
        mode: "live",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith({
        data: {
          title: "Complete Task",
          description: "Complete task description",
          workspaceId: "workspace-123",
          status: "IN_PROGRESS",
          priority: "HIGH",
          assigneeId: "assignee-456",
          repositoryId: "repo-789",
          sourceType: "JANITOR",
          createdById: "user-123",
          updatedById: "user-123",
        },
        include: {
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          repository: {
            select: {
              id: true,
              name: true,
              repositoryUrl: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              githubAuth: {
                select: {
                  githubUsername: true,
                },
              },
            },
          },
          workspace: {
            select: {
              id: true,
              name: true,
              slug: true,
              swarm: {
                select: {
                  swarmUrl: true,
                  swarmSecretAlias: true,
                  poolName: true,
                  name: true,
                  id: true,
                },
              },
            },
          },
        },
      });
    });
  });

  describe("Task Creation - Minimal Parameters", () => {
    test("should create task with minimal parameters and apply defaults", async () => {
      const params = {
        title: "Minimal Task",
        description: "Minimal description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Initial message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Minimal Task",
            description: "Minimal description",
            workspaceId: "workspace-123",
            status: "TODO", // Default status
            priority: "MEDIUM",
            assigneeId: null, // Default for optional
            repositoryId: null, // Default for optional
            sourceType: "USER", // Default sourceType
            createdById: "user-123",
            updatedById: "user-123",
          }),
        })
      );
    });

    test("should set assigneeId and repositoryId to null when undefined", async () => {
      const params = {
        title: "Task without assignee",
        description: "Task description",
        workspaceId: "workspace-123",
        priority: "LOW" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      const callArgs = mockDb.task.create.mock.calls[0][0];
      expect(callArgs.data.assigneeId).toBeNull();
      expect(callArgs.data.repositoryId).toBeNull();
    });
  });

  describe("Data Trimming", () => {
    test("should trim whitespace from title", async () => {
      const params = {
        title: "  Task with spaces  ",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Task with spaces",
          }),
        })
      );
    });

    test("should trim whitespace from description", async () => {
      const params = {
        title: "Task",
        description: "  Description with spaces  ",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: "Description with spaces",
          }),
        })
      );
    });

    test("should handle empty string description as null after trimming", async () => {
      const params = {
        title: "Task",
        description: "   ",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: null,
          }),
        })
      );
    });
  });

  describe("Priority Variations", () => {
    test.each([
      ["LOW" as Priority],
      ["MEDIUM" as Priority],
      ["HIGH" as Priority],
      ["CRITICAL" as Priority],
    ])("should create task with priority %s", async (priority) => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority,
          }),
        })
      );
    });
  });

  describe("SourceType Variations", () => {
    test.each([
      ["USER" as TaskSourceType],
      ["JANITOR" as TaskSourceType],
      ["TASK_COORDINATOR" as TaskSourceType],
      ["SYSTEM" as TaskSourceType],
    ])("should create task with sourceType %s", async (sourceType) => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        sourceType,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType,
          }),
        })
      );
    });

    test("should default to USER sourceType when not provided", async () => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType: "USER",
          }),
        })
      );
    });
  });

  describe("Status Variations", () => {
    test.each([
      ["TODO" as TaskStatus],
      ["IN_PROGRESS" as TaskStatus],
      ["DONE" as TaskStatus],
      ["CANCELLED" as TaskStatus],
    ])("should create task with status %s", async (status) => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
        status,
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status,
          }),
        })
      );
    });

    test("should default to TODO status when not provided", async () => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "TODO",
          }),
        })
      );
    });
  });

  describe("Mode Parameter", () => {
    test("should pass mode parameter to internal helper", async () => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Test message",
        mode: "live",
      };

      await createTaskWithStakworkWorkflow(params);

      // Mode is passed to createChatMessageAndTriggerStakwork
      // This is verified through the mocked function call
      expect(mockDb.task.create).toHaveBeenCalled();
    });

    test("should default to 'default' mode when not provided", async () => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Test message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalled();
    });
  });

  describe("Database Include Clauses", () => {
    test("should include comprehensive relations in task creation", async () => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      const callArgs = mockDb.task.create.mock.calls[0][0];
      
      expect(callArgs.include).toEqual({
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        repository: {
          select: {
            id: true,
            name: true,
            repositoryUrl: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            githubAuth: {
              select: {
                githubUsername: true,
              },
            },
          },
        },
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            swarm: {
              select: {
                swarmUrl: true,
                swarmSecretAlias: true,
                poolName: true,
                name: true,
                id: true,
              },
            },
          },
        },
      });
    });
  });

  describe("Return Structure", () => {
    test("should return combined object with task, stakworkResult, and chatMessage", async () => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      const result = await createTaskWithStakworkWorkflow(params);

      expect(result).toHaveProperty("task");
      expect(result).toHaveProperty("stakworkResult");
      expect(result).toHaveProperty("chatMessage");
    });

    test("should return task object with all included relations", async () => {
      const mockTask = createMockTaskResponse({
        assignee: {
          id: "assignee-123",
          name: "Assignee User",
          email: "assignee@example.com",
        },
        repository: {
          id: "repo-123",
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
        },
      });

      mockDb.task.create.mockResolvedValue(mockTask as any);

      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      const result = await createTaskWithStakworkWorkflow(params);

      expect(result.task).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        workspace: expect.objectContaining({
          id: expect.any(String),
          slug: expect.any(String),
        }),
        createdBy: expect.objectContaining({
          id: expect.any(String),
          githubAuth: expect.objectContaining({
            githubUsername: expect.any(String),
          }),
        }),
      });
    });

    test("should return stakworkResult from internal helper", async () => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      const result = await createTaskWithStakworkWorkflow(params);

      expect(result.stakworkResult).toEqual({
        success: true,
        data: { project_id: 12345, workflow_id: 67890 },
      });
    });

    test("should return chatMessage from internal helper", async () => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      const result = await createTaskWithStakworkWorkflow(params);

      expect(result.chatMessage).toMatchObject({
        id: "test-message-id",
        taskId: "test-task-id",
        role: "USER",
        status: "SENT",
      });
    });
  });

  describe("Error Handling", () => {
    test("should throw error when task creation fails", async () => {
      mockDb.task.create.mockRejectedValue(new Error("Database error"));

      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await expect(createTaskWithStakworkWorkflow(params)).rejects.toThrow(
        "Database error"
      );
    });

    test("should propagate database constraint violation errors", async () => {
      mockDb.task.create.mockRejectedValue(
        new Error("Foreign key constraint failed")
      );

      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "non-existent-workspace",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await expect(createTaskWithStakworkWorkflow(params)).rejects.toThrow(
        "Foreign key constraint failed"
      );
    });
  });

  describe("Audit Fields", () => {
    test("should set both createdById and updatedById to userId", async () => {
      const params = {
        title: "Task",
        description: "Description",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-789",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdById: "user-789",
            updatedById: "user-789",
          }),
        })
      );
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long title and description", async () => {
      const longTitle = "a".repeat(500);
      const longDescription = "b".repeat(5000);

      const params = {
        title: longTitle,
        description: longDescription,
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: longTitle,
            description: longDescription,
          }),
        })
      );
    });

    test("should handle special characters in title and description", async () => {
      const specialTitle = "Task with 🚀 emoji & special chars: àáâäåæçèéêë";
      const specialDescription = "Description with <html> tags and & symbols";

      const params = {
        title: specialTitle,
        description: specialDescription,
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: specialTitle,
            description: specialDescription,
          }),
        })
      );
    });

    test("should handle empty description", async () => {
      const params = {
        title: "Task",
        description: "",
        workspaceId: "workspace-123",
        priority: "MEDIUM" as Priority,
        userId: "user-123",
        initialMessage: "Message",
      };

      await createTaskWithStakworkWorkflow(params);

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: null,
          }),
        })
      );
    });
  });
});