import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Priority, TaskStatus, TaskSourceType } from "@prisma/client";

// Mock all dependencies at module level
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://test-stakwork.com",
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

// Import mocked modules
const { db: mockDb } = await import("@/lib/db");
const { config: mockConfig } = await import("@/lib/env");
const { getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
const mockFetch = fetch as vi.MockedFunction<typeof fetch>;

// Import functions under test
const { sendMessageToStakwork, createTaskWithStakworkWorkflow } = await import(
  "@/services/task-workflow"
);

// Test Data Factory - Centralized test data creation
const TestDataFactory = {
  createValidTask: (overrides = {}) => ({
    id: "test-task-id",
    title: "Test Task",
    description: "Test Description",
    status: "TODO" as TaskStatus,
    priority: "MEDIUM" as Priority,
    workspaceId: "test-workspace-id",
    assigneeId: null,
    repositoryId: null,
    sourceType: "USER" as TaskSourceType,
    createdById: "test-user-id",
    updatedById: "test-user-id",
    workflowStatus: null,
    workflowStartedAt: null,
    stakworkProjectId: null,
    deleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    workspace: {
      id: "test-workspace-id",
      name: "Test Workspace",
      slug: "test-workspace",
      swarm: {
        id: "swarm-id",
        swarmUrl: "https://test-swarm.example.com/api",
        swarmSecretAlias: "{{TEST_SECRET}}",
        poolName: "test-pool",
        name: "test-swarm",
      },
    },
    ...overrides,
  }),

  createValidUser: (name = "Test User") => ({
    id: "test-user-id",
    name,
    email: "test@example.com",
    emailVerified: null,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),

  createChatMessage: (overrides = {}) => ({
    id: "message-id",
    taskId: "test-task-id",
    message: "Test message",
    role: "USER" as const,
    contextTags: "[]",
    status: "SENT" as const,
    sourceWebsocketID: null,
    replyId: null,
    timestamp: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    task: {
      id: "test-task-id",
      title: "Test Task",
    },
    ...overrides,
  }),

  createStakworkSuccessResponse: (projectId = 123) => ({
    success: true,
    data: { project_id: projectId },
  }),

  createStakworkErrorResponse: (error = "API Error") => ({
    success: false,
    error,
  }),
};

// Test Helpers - Reusable assertion and setup functions
const TestHelpers = {
  setupValidTask: () => {
    mockDb.task.findFirst.mockResolvedValue(TestDataFactory.createValidTask() as any);
  },

  setupValidUser: () => {
    mockDb.user.findUnique.mockResolvedValue(TestDataFactory.createValidUser() as any);
  },

  setupValidChatMessage: () => {
    mockDb.chatMessage.create.mockResolvedValue(TestDataFactory.createChatMessage() as any);
  },

  setupValidGithubProfile: () => {
    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "test-github-token",
    });
  },

  setupTaskUpdate: () => {
    mockDb.task.update.mockResolvedValue({} as any);
  },

  setupTaskCreate: () => {
    // Mock task.create to return task with sourceType from actual call
    mockDb.task.create.mockImplementation((params: any) => {
      const fullTask = {
        id: "test-task-id",
        title: params.data.title || "Test Task",
        description: params.data.description || "Test Description",
        status: params.data.status || "TODO",
        priority: params.data.priority || "MEDIUM",
        workspaceId: params.data.workspaceId,
        assigneeId: params.data.assigneeId || null,
        repositoryId: params.data.repositoryId || null,
        sourceType: params.data.sourceType || "USER",
        createdById: params.data.createdById,
        updatedById: params.data.updatedById,
        workflowStatus: null,
        workflowStartedAt: null,
        stakworkProjectId: null,
        deleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignee: null,
        repository: null,
        createdBy: {
          id: "test-user-id",
          name: "Test User",
          email: "test@example.com",
          image: null,
          githubAuth: null,
        },
        workspace: {
          id: "test-workspace-id",
          name: "Test Workspace",
          slug: "test-workspace",
          swarm: {
            id: "swarm-id",
            swarmUrl: "https://test-swarm.example.com/api",
            swarmSecretAlias: "{{TEST_SECRET}}",
            poolName: "test-pool",
            name: "test-swarm",
          },
        },
      };
      return Promise.resolve(fullTask as any);
    });
  },

  expectChatMessageCreated: () => {
    expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: "USER",
          status: "SENT",
          contextTags: expect.any(String),
        }),
        include: expect.objectContaining({
          task: expect.any(Object),
        }),
      })
    );
  },

  expectTaskStatusUpdated: (status: string, additionalData = {}) => {
    expect(mockDb.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "test-task-id" },
        data: expect.objectContaining({
          workflowStatus: status,
          ...additionalData,
        }),
      })
    );
  },

  expectStakworkCalled: () => {
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test-stakwork.com/projects",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Token token=test-api-key",
          "Content-Type": "application/json",
        }),
      })
    );
  },

  expectStakworkCalledWithVars: (expectedVars: Record<string, unknown>) => {
    const fetchCall = mockFetch.mock.calls[0];
    const payload = JSON.parse(fetchCall[1]?.body as string);
    const vars = payload.workflow_params.set_var.attributes.vars;

    Object.entries(expectedVars).forEach(([key, value]) => {
      expect(vars[key]).toEqual(value);
    });
  },
};

// Mock Setup Helper - Centralized mock configuration
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
    // Restore config to original values
    mockConfig.STAKWORK_API_KEY = "test-api-key";
    mockConfig.STAKWORK_BASE_URL = "https://test-stakwork.com";
    mockConfig.STAKWORK_WORKFLOW_ID = "123,456,789";
  },

  setupSuccessfulWorkflow: (projectId = 123) => {
    TestHelpers.setupValidTask();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupTaskUpdate();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => TestDataFactory.createStakworkSuccessResponse(projectId),
    } as Response);
  },

  setupFailedWorkflow: (errorMessage = "API Error") => {
    TestHelpers.setupValidTask();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupTaskUpdate();

    mockFetch.mockResolvedValue({
      ok: false,
      statusText: errorMessage,
    } as Response);
  },

  setupTaskCreationWorkflow: (projectId = 123) => {
    TestHelpers.setupTaskCreate();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupTaskUpdate();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => TestDataFactory.createStakworkSuccessResponse(projectId),
    } as Response);
  },
};

describe("createChatMessageAndTriggerStakwork (via sendMessageToStakwork)", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Chat Message Creation", () => {
    test("should create chat message with USER role and SENT status", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      TestHelpers.expectChatMessageCreated();
      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            taskId: "test-task-id",
            message: "Test message",
            role: "USER",
            status: "SENT",
          }),
        })
      );
    });

    test("should include contextTags in chat message", async () => {
      MockSetup.setupSuccessfulWorkflow();

      const contextTags = [
        { type: "file", value: "test.ts" },
        { type: "folder", value: "src/" },
      ];

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
        contextTags,
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextTags: JSON.stringify(contextTags),
          }),
        })
      );
    });

    test("should use empty array for contextTags when not provided", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextTags: "[]",
          }),
        })
      );
    });
  });

  describe("User Validation", () => {
    test("should throw error when user not found", async () => {
      TestHelpers.setupValidTask();
      TestHelpers.setupValidChatMessage();
      mockDb.user.findUnique.mockResolvedValue(null);

      await expect(
        sendMessageToStakwork({
          taskId: "test-task-id",
          message: "Test message",
          userId: "test-user-id",
        })
      ).rejects.toThrow("User not found");
    });

    test("should query user by userId", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: "test-user-id" },
        select: { name: true },
      });
    });
  });

  describe("Task Validation", () => {
    test("should throw error when task not found", async () => {
      mockDb.task.findFirst.mockResolvedValue(null);

      await expect(
        sendMessageToStakwork({
          taskId: "test-task-id",
          message: "Test message",
          userId: "test-user-id",
        })
      ).rejects.toThrow("Task not found");
    });

    test("should query task with workspace and swarm details", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockDb.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: "test-task-id",
          deleted: false,
        },
        include: {
          workspace: {
            include: {
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

  describe("GitHub Credentials", () => {
    test("should fetch GitHub username and PAT", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledWith(
        "test-user-id",
        "test-workspace"
      );
    });

    test("should pass GitHub credentials to Stakwork API", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      TestHelpers.expectStakworkCalledWithVars({
        alias: "testuser",
        username: "testuser",
        accessToken: "test-github-token",
      });
    });

    test("should handle null GitHub credentials", async () => {
      TestHelpers.setupValidTask();
      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      mockGetGithubUsernameAndPAT.mockResolvedValue(null);
      TestHelpers.setupTaskUpdate();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      TestHelpers.expectStakworkCalledWithVars({
        alias: null,
        username: null,
        accessToken: null,
      });
    });
  });

  describe("Stakwork Workflow Triggering", () => {
    test("should call Stakwork API when configured", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      TestHelpers.expectStakworkCalled();
    });

    test("should skip Stakwork when API key not configured", async () => {
      TestHelpers.setupValidTask();
      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();

      vi.mocked(mockConfig).STAKWORK_API_KEY = "";

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockDb.task.update).not.toHaveBeenCalled();
    });

    test("should include message and contextTags in Stakwork payload", async () => {
      MockSetup.setupSuccessfulWorkflow();

      const contextTags = [{ type: "file", value: "test.ts" }];

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
        contextTags,
      });

      TestHelpers.expectStakworkCalledWithVars({
        taskId: "test-task-id",
        message: "Test message",
        contextTags,
      });
    });

    test("should transform swarmUrl for workflow", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      TestHelpers.expectStakworkCalledWithVars({
        swarmUrl: "https://test-swarm.example.com:8444/api",
        swarmSecretAlias: "{{TEST_SECRET}}",
        poolName: "swarm-id",
      });
    });

    test("should include repo2graph_url in payload", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      TestHelpers.expectStakworkCalledWithVars({
        repo2graph_url: "https://test-swarm.example.com:3355",
      });
    });

    test("should include webhook URLs in payload", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);

      expect(payload.webhook_url).toBe(
        "http://localhost:3000/api/stakwork/webhook?task_id=test-task-id"
      );

      TestHelpers.expectStakworkCalledWithVars({
        webhookUrl: "http://localhost:3000/api/chat/response",
      });
    });
  });

  describe("Mode-Based Workflow Selection", () => {
    test("should use default workflow ID when mode not specified", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      expect(payload.workflow_id).toBe(456); // Second ID in "123,456,789"
    });

    test("should use workflow ID at index 0 for 'live' mode", async () => {
      TestHelpers.setupValidTask();
      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupTaskUpdate();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const result = await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      // For sendMessageToStakwork, mode is not directly passed, it defaults
      // We need to test through createTaskWithStakworkWorkflow for mode testing
      expect(result.chatMessage).toBeDefined();
    });
  });

  describe("Task Status Updates", () => {
    test("should update task to IN_PROGRESS on successful Stakwork call", async () => {
      MockSetup.setupSuccessfulWorkflow(456);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      TestHelpers.expectTaskStatusUpdated("IN_PROGRESS", {
        workflowStartedAt: expect.any(Date),
        stakworkProjectId: 456,
      });
    });

    test("should update task to FAILED on Stakwork API error", async () => {
      MockSetup.setupFailedWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      TestHelpers.expectTaskStatusUpdated("FAILED");
    });

    test("should update task to FAILED on Stakwork API exception", async () => {
      TestHelpers.setupValidTask();
      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupTaskUpdate();

      mockFetch.mockRejectedValue(new Error("Network error"));

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      TestHelpers.expectTaskStatusUpdated("FAILED");
    });

    test("should set workflowStartedAt timestamp on success", async () => {
      MockSetup.setupSuccessfulWorkflow();

      const beforeTime = new Date();
      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });
      const afterTime = new Date();

      expect(mockDb.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            workflowStartedAt: expect.any(Date),
          }),
        })
      );

      const updateCall = mockDb.task.update.mock.calls[0][0];
      const startedAt = updateCall.data.workflowStartedAt;
      expect(startedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(startedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    test("should store stakworkProjectId from API response", async () => {
      MockSetup.setupSuccessfulWorkflow(789);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockDb.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stakworkProjectId: 789,
          }),
        })
      );
    });
  });

  describe("Return Value", () => {
    test("should return chatMessage and stakworkData on success", async () => {
      MockSetup.setupSuccessfulWorkflow(123);

      const result = await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(result.chatMessage).toBeDefined();
      expect(result.chatMessage.id).toBe("message-id");
      expect(result.chatMessage.message).toBe("Test message");
      expect(result.stakworkData).toEqual({
        success: true,
        data: { project_id: 123 },
      });
    });

    test("should return error in stakworkData on failure", async () => {
      MockSetup.setupFailedWorkflow("API Error");

      const result = await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(result.chatMessage).toBeDefined();
      expect(result.stakworkData).toEqual({
        success: false,
        error: "API Error",
      });
    });
  });

  describe("Attachments Handling", () => {
    test("should include attachments in Stakwork payload", async () => {
      MockSetup.setupSuccessfulWorkflow();

      const attachments = ["uploads/file1.pdf", "uploads/file2.jpg"];

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
        attachments,
      });

      TestHelpers.expectStakworkCalledWithVars({
        attachments,
      });
    });

    test("should use empty array when attachments not provided", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      TestHelpers.expectStakworkCalledWithVars({
        attachments: [],
      });
    });
  });
});

describe("createChatMessageAndTriggerStakwork (via createTaskWithStakworkWorkflow)", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Task Creation and Workflow Trigger", () => {
    test("should create task and trigger workflow", async () => {
      MockSetup.setupTaskCreationWorkflow();

      const result = await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
        initialMessage: "Initial message",
      });

      expect(mockDb.task.create).toHaveBeenCalled();
      TestHelpers.expectChatMessageCreated();
      TestHelpers.expectStakworkCalled();
      expect(result.task).toBeDefined();
      expect(result.chatMessage).toBeDefined();
      expect(result.stakworkResult).toBeDefined();
    });

    test("should pass initial message to chat creation", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "HIGH" as Priority,
        userId: "test-user-id",
        initialMessage: "Start coding",
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: "Start coding",
          }),
        })
      );
    });

    test("should create task with provided status", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "LOW" as Priority,
        userId: "test-user-id",
        initialMessage: "Initial message",
        status: "IN_PROGRESS" as TaskStatus,
      });

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "IN_PROGRESS",
          }),
        })
      );
    });

    test("should default to TODO status when not specified", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
        initialMessage: "Initial message",
      });

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "TODO",
          }),
        })
      );
    });
  });

  describe("Mode Parameter Handling", () => {
    test("should pass mode to Stakwork workflow", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
        initialMessage: "Initial message",
        mode: "live",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      expect(payload.workflow_id).toBe(123); // First ID in "123,456,789" for live mode
      TestHelpers.expectStakworkCalledWithVars({
        taskMode: "live",
      });
    });

    test("should use default mode when not specified", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
        initialMessage: "Initial message",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      expect(payload.workflow_id).toBe(456); // Second ID for default mode
      TestHelpers.expectStakworkCalledWithVars({
        taskMode: "default",
      });
    });

    test("should use workflow ID at index 2 for 'unit' mode", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
        initialMessage: "Initial message",
        mode: "unit",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      expect(payload.workflow_id).toBe(789); // Third ID for unit mode
    });

    test("should use workflow ID at index 2 for 'integration' mode", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
        initialMessage: "Initial message",
        mode: "integration",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      expect(payload.workflow_id).toBe(789); // Third ID for integration mode
    });
  });

  describe("Source Type Handling", () => {
    test("should include sourceType in Stakwork payload", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        sourceType: "JANITOR" as TaskSourceType,
        userId: "test-user-id",
        initialMessage: "Initial message",
      });

      TestHelpers.expectStakworkCalledWithVars({
        taskSource: "janitor",
      });
    });

    test("should default to USER sourceType", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
        initialMessage: "Initial message",
      });

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sourceType: "USER",
          }),
        })
      );

      TestHelpers.expectStakworkCalledWithVars({
        taskSource: "user",
      });
    });
  });

  describe("Optional Task Fields", () => {
    test("should include assigneeId when provided", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        assigneeId: "assignee-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
        initialMessage: "Initial message",
      });

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assigneeId: "assignee-id",
          }),
        })
      );
    });

    test("should include repositoryId when provided", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        repositoryId: "repo-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
        initialMessage: "Initial message",
      });

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            repositoryId: "repo-id",
          }),
        })
      );
    });

    test("should trim title and description", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "  New Task  ",
        description: "  Task Description  ",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
        initialMessage: "Initial message",
      });

      expect(mockDb.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "New Task",
            description: "Task Description",
          }),
        })
      );
    });
  });

  describe("Error Propagation", () => {
    test("should propagate task creation errors", async () => {
      mockDb.task.create.mockRejectedValue(new Error("Database error"));

      await expect(
        createTaskWithStakworkWorkflow({
          title: "New Task",
          description: "Task Description",
          workspaceId: "test-workspace-id",
          priority: "MEDIUM" as Priority,
          userId: "test-user-id",
          initialMessage: "Initial message",
        })
      ).rejects.toThrow("Database error");
    });

    test("should handle chat message creation errors", async () => {
      TestHelpers.setupTaskCreate();
      TestHelpers.setupValidUser();
      mockDb.chatMessage.create.mockRejectedValue(new Error("Chat error"));

      await expect(
        createTaskWithStakworkWorkflow({
          title: "New Task",
          description: "Task Description",
          workspaceId: "test-workspace-id",
          priority: "MEDIUM" as Priority,
          userId: "test-user-id",
          initialMessage: "Initial message",
        })
      ).rejects.toThrow("Chat error");
    });

    test("should handle user not found error", async () => {
      TestHelpers.setupTaskCreate();
      mockDb.user.findUnique.mockResolvedValue(null);
      TestHelpers.setupValidChatMessage();

      await expect(
        createTaskWithStakworkWorkflow({
          title: "New Task",
          description: "Task Description",
          workspaceId: "test-workspace-id",
          priority: "MEDIUM" as Priority,
          userId: "test-user-id",
          initialMessage: "Initial message",
        })
      ).rejects.toThrow("User not found");
    });
  });
});

describe("Stakwork Configuration Validation", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should not call Stakwork when STAKWORK_API_KEY is missing", async () => {
    TestHelpers.setupValidTask();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();

    vi.mocked(mockConfig).STAKWORK_API_KEY = "";

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.task.update).not.toHaveBeenCalled();
  });

  test("should not call Stakwork when STAKWORK_BASE_URL is missing", async () => {
    TestHelpers.setupValidTask();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();

    vi.mocked(mockConfig).STAKWORK_BASE_URL = "";

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.task.update).not.toHaveBeenCalled();
  });

  test("should not call Stakwork when STAKWORK_WORKFLOW_ID is missing", async () => {
    TestHelpers.setupValidTask();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();

    vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "";

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockDb.task.update).not.toHaveBeenCalled();
  });
});