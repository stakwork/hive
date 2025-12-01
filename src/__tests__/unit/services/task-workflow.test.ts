import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Priority, TaskStatus, TaskSourceType } from "@prisma/client";

// Mock all dependencies at module level
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
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

vi.mock("@/config/env", () => ({
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

vi.mock("@/services/task-coordinator", () => ({
  buildFeatureContext: vi.fn(),
}));

// Mock fetch globally
global.fetch = vi.fn();

// Import mocked modules
const { db: mockDb } = await import("@/lib/db");
const { config: mockConfig } = await import("@/config/env");
const { getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
const { buildFeatureContext: mockBuildFeatureContext } = await import("@/services/task-coordinator");
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

  createCallStakworkAPIParams: (overrides = {}) => ({
    taskId: "test-task-id",
    message: "Test message",
    contextTags: [],
    userName: "testuser",
    accessToken: "test-github-token",
    swarmUrl: "https://test-swarm.example.com:8444/api",
    swarmSecretAlias: "{{TEST_SECRET}}",
    poolName: "test-pool",
    repo2GraphUrl: "https://test-swarm.example.com:3355",
    attachments: [],
    mode: "default",
    taskSource: "USER",
    ...overrides,
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

  setupTaskStatusCheck: (status: TaskStatus = "TODO") => {
    mockDb.task.findUnique.mockResolvedValue({ status } as any);
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

  expectCallStakworkAPIPayload: (expectedPayload: {
    workflow_id?: number;
    webhook_url?: string;
    vars?: Record<string, unknown>;
  }) => {
    const fetchCall = mockFetch.mock.calls[0];
    const payload = JSON.parse(fetchCall[1]?.body as string);

    if (expectedPayload.workflow_id !== undefined) {
      expect(payload.workflow_id).toBe(expectedPayload.workflow_id);
    }

    if (expectedPayload.webhook_url !== undefined) {
      expect(payload.webhook_url).toBe(expectedPayload.webhook_url);
    }

    if (expectedPayload.vars) {
      const vars = payload.workflow_params.set_var.attributes.vars;
      Object.entries(expectedPayload.vars).forEach(([key, value]) => {
        expect(vars[key]).toEqual(value);
      });
    }
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
    TestHelpers.setupTaskStatusCheck("TODO");
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
    TestHelpers.setupTaskStatusCheck("TODO");
    TestHelpers.setupTaskUpdate();

    mockFetch.mockResolvedValue({
      ok: false,
      statusText: errorMessage,
    } as Response);
  },

  setupTaskCreationWorkflow: (sourceType: TaskSourceType = "USER", projectId = 123) => {
    TestHelpers.setupTaskCreate();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupTaskStatusCheck("TODO");
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
              repositories: {
                take: 1,
                orderBy: { createdAt: "desc" },
                select: {
                  repositoryUrl: true,
                  branch: true,
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
        status: "IN_PROGRESS",
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
      TestHelpers.setupTaskStatusCheck("TODO");
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

    test("should build message from task title and description", async () => {
      MockSetup.setupTaskCreationWorkflow();

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "HIGH" as Priority,
        userId: "test-user-id",
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: "New Task\n\nTask Description",
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

    test("should default to IN_PROGRESS status when not specified", async () => {
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
            status: "IN_PROGRESS",
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
      MockSetup.setupTaskCreationWorkflow("JANITOR" as TaskSourceType);

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        sourceType: "JANITOR" as TaskSourceType,
        userId: "test-user-id",
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

describe("Feature Context Integration", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("via createTaskWithStakworkWorkflow", () => {
    test("should build and include feature context when task has featureId and phaseId", async () => {
      mockBuildFeatureContext.mockResolvedValue({
        feature: {
          title: "Test Feature",
          brief: "Feature brief",
          userStories: ["Story 1", "Story 2"],
          requirements: "Feature requirements",
          architecture: "Architecture details",
        },
        currentPhase: {
          name: "Implementation",
          description: "Implementation phase",
          tickets: [
            { id: "ticket-1", title: "Ticket 1", description: "Desc 1", status: "TODO" },
          ],
        },
      });


      // Setup task with featureId and phaseId
      TestHelpers.setupTaskCreate();
      mockDb.task.create.mockImplementation((params: any) => {
        return Promise.resolve({
          ...TestDataFactory.createValidTask({
            featureId: "feature-123",
            phaseId: "phase-456",
          }),
          title: params.data.title,
          description: params.data.description,
          featureId: "feature-123",
          phaseId: "phase-456",
        } as any);
      });

      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupTaskStatusCheck("TODO");
      TestHelpers.setupTaskUpdate();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
      });

      // Verify buildFeatureContext was called with correct IDs
      expect(mockBuildFeatureContext).toHaveBeenCalledWith("feature-123", "phase-456");

      // Verify feature context was included in Stakwork payload
      TestHelpers.expectStakworkCalledWithVars({
        featureContext: {
          feature: {
            title: "Test Feature",
            brief: "Feature brief",
            userStories: ["Story 1", "Story 2"],
            requirements: "Feature requirements",
            architecture: "Architecture details",
          },
          currentPhase: {
            name: "Implementation",
            description: "Implementation phase",
            tickets: [
              { id: "ticket-1", title: "Ticket 1", description: "Desc 1", status: "TODO" },
            ],
          },
        },
      });
    });

    test("should continue without feature context when buildFeatureContext fails", async () => {
      mockBuildFeatureContext.mockRejectedValue(new Error("Feature context error"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});


      TestHelpers.setupTaskCreate();
      mockDb.task.create.mockImplementation((params: any) => {
        return Promise.resolve({
          ...TestDataFactory.createValidTask({
            featureId: "feature-123",
            phaseId: "phase-456",
          }),
          featureId: "feature-123",
          phaseId: "phase-456",
        } as any);
      });

      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupTaskStatusCheck("TODO");
      TestHelpers.setupTaskUpdate();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error building feature context:",
        expect.any(Error)
      );

      // Verify Stakwork was still called without feature context
      TestHelpers.expectStakworkCalled();

      consoleErrorSpy.mockRestore();
    });

    test("should not call buildFeatureContext when task has no featureId", async () => {
      // mockBuildFeatureContext is already mocked at module level


      TestHelpers.setupTaskCreate();
      mockDb.task.create.mockImplementation((params: any) => {
        return Promise.resolve({
          ...TestDataFactory.createValidTask(),
          featureId: null,
          phaseId: "phase-456",
        } as any);
      });

      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupTaskStatusCheck("TODO");
      TestHelpers.setupTaskUpdate();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
      });

      expect(mockBuildFeatureContext).not.toHaveBeenCalled();
    });

    test("should not call buildFeatureContext when task has no phaseId", async () => {
      // mockBuildFeatureContext is already mocked at module level


      TestHelpers.setupTaskCreate();
      mockDb.task.create.mockImplementation((params: any) => {
        return Promise.resolve({
          ...TestDataFactory.createValidTask(),
          featureId: "feature-123",
          phaseId: null,
        } as any);
      });

      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupTaskStatusCheck("TODO");
      TestHelpers.setupTaskUpdate();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
      });

      expect(mockBuildFeatureContext).not.toHaveBeenCalled();
    });
  });

  describe("via sendMessageToStakwork", () => {
    test("should include provided featureContext in Stakwork payload", async () => {
      MockSetup.setupSuccessfulWorkflow();

      const featureContext = {
        feature: {
          title: "Authentication Feature",
          brief: "User authentication system",
          userStories: ["As a user, I can log in"],
          requirements: "Secure authentication",
          architecture: "OAuth 2.0",
        },
        currentPhase: {
          name: "Testing",
          description: "Testing phase",
          tickets: [],
        },
      };

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
        featureContext,
      });

      TestHelpers.expectStakworkCalledWithVars({
        featureContext,
      });
    });

    test("should not include featureContext when not provided", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.featureContext).toBeUndefined();
    });
  });
});

describe("Repository Configuration Handling", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should extract repository URL and branch from workspace repositories", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const taskWithRepo = TestDataFactory.createValidTask({
      workspace: {
        id: "test-workspace-id",
        slug: "test-workspace",
        swarm: {
          id: "swarm-id",
          swarmUrl: "https://test-swarm.example.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolName: "test-pool",
          name: "test-swarm",
        },
        repositories: [
          {
            repositoryUrl: "https://github.com/test/repo",
            branch: "main",
          },
        ],
      },
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithRepo as any);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      repo_url: "https://github.com/test/repo",
      base_branch: "main",
    });
  });

  test("should handle workspace with no repositories", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const taskWithoutRepo = TestDataFactory.createValidTask({
      workspace: {
        id: "test-workspace-id",
        slug: "test-workspace",
        swarm: {
          id: "swarm-id",
          swarmUrl: "https://test-swarm.example.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolName: "test-pool",
          name: "test-swarm",
        },
        repositories: [],
      },
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithoutRepo as any);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      repo_url: null,
      base_branch: null,
    });
  });

  test("should use most recent repository when multiple exist", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const taskWithMultipleRepos = TestDataFactory.createValidTask({
      workspace: {
        id: "test-workspace-id",
        slug: "test-workspace",
        swarm: {
          id: "swarm-id",
          swarmUrl: "https://test-swarm.example.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolName: "test-pool",
          name: "test-swarm",
        },
        repositories: [
          {
            repositoryUrl: "https://github.com/test/newest-repo",
            branch: "develop",
          },
        ],
      },
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithMultipleRepos as any);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      repo_url: "https://github.com/test/newest-repo",
      base_branch: "develop",
    });
  });
});

describe("Workspace Configuration Validation", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should handle workspace with null swarm configuration", async () => {
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();

    const taskWithNullSwarm = TestDataFactory.createValidTask({
      workspace: {
        id: "test-workspace-id",
        slug: "test-workspace",
        swarm: null,
        repositories: [],
      },
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithNullSwarm as any);

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
      swarmUrl: "",
      swarmSecretAlias: null,
      poolName: null,
      repo2graph_url: "",
    });
  });

  test("should transform swarmUrl correctly for workflow API", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const taskWithSwarmUrl = TestDataFactory.createValidTask({
      workspace: {
        id: "test-workspace-id",
        slug: "test-workspace",
        swarm: {
          id: "swarm-id",
          swarmUrl: "https://custom-swarm.example.com/api",
          swarmSecretAlias: "{{CUSTOM_SECRET}}",
          poolName: "custom-pool",
          name: "custom-swarm",
        },
        repositories: [],
      },
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithSwarmUrl as any);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      swarmUrl: "https://custom-swarm.example.com:8444/api",
      repo2graph_url: "https://custom-swarm.example.com:3355",
    });
  });

  test("should use swarm ID as poolName", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      poolName: "swarm-id",
    });
  });
});

describe("Task Status Consistency", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should not update task status when already IN_PROGRESS", async () => {
    TestHelpers.setupValidTask();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupTaskStatusCheck("IN_PROGRESS");
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

    const updateCall = mockDb.task.update.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
    expect(updateCall.data.workflowStatus).toBe("IN_PROGRESS");
  });

  test("should not update task status when already DONE", async () => {
    TestHelpers.setupValidTask();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupTaskStatusCheck("DONE");
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

    const updateCall = mockDb.task.update.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  test("should update task status from TODO to IN_PROGRESS on successful workflow start", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    const updateCall = mockDb.task.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("IN_PROGRESS");
    expect(updateCall.data.workflowStatus).toBe("IN_PROGRESS");
  });
});

describe("Timestamp and Metadata Handling", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should set workflowStartedAt to current timestamp", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const beforeTime = new Date();
    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });
    const afterTime = new Date();

    const updateCall = mockDb.task.update.mock.calls[0][0];
    const startedAt = updateCall.data.workflowStartedAt;

    expect(startedAt).toBeInstanceOf(Date);
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    expect(startedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
  });

  test("should store stakworkProjectId from Stakwork response", async () => {
    MockSetup.setupSuccessfulWorkflow(12345);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    const updateCall = mockDb.task.update.mock.calls[0][0];
    expect(updateCall.data.stakworkProjectId).toBe(12345);
  });

  test("should log warning when project_id missing in success response", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    TestHelpers.setupValidTask();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupTaskStatusCheck("TODO");
    TestHelpers.setupTaskUpdate();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    } as Response);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "No project_id found in Stakwork response:",
      expect.objectContaining({ success: true })
    );

    const updateCall = mockDb.task.update.mock.calls[0][0];
    expect(updateCall.data.stakworkProjectId).toBeUndefined();
    expect(updateCall.data.workflowStatus).toBe("IN_PROGRESS");

    consoleWarnSpy.mockRestore();
  });

  test("should include workspaceId in Stakwork payload", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      workspaceId: "test-workspace-id",
    });
  });

  test("should include runBuild and runTestSuite flags in Stakwork payload", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const taskWithFlags = TestDataFactory.createValidTask({
      runBuild: false,
      runTestSuite: false,
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithFlags as any);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      runBuild: false,
      runTestSuite: false,
    });
  });
});

describe("generateChatTitle Parameter Handling", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should include generateChatTitle when explicitly set to true", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
      generateChatTitle: true,
    });

    TestHelpers.expectStakworkCalledWithVars({
      generateChatTitle: true,
    });
  });

  test("should include generateChatTitle when explicitly set to false", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
      generateChatTitle: false,
    });

    TestHelpers.expectStakworkCalledWithVars({
      generateChatTitle: false,
    });
  });

  test("should not include generateChatTitle when not provided", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    const fetchCall = mockFetch.mock.calls[0];
    const payload = JSON.parse(fetchCall[1]?.body as string);
    const vars = payload.workflow_params.set_var.attributes.vars;

    expect(vars.generateChatTitle).toBeUndefined();
  });
});

describe("Feature Context Integration", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("via createTaskWithStakworkWorkflow", () => {
    test("should build and include feature context when task has featureId and phaseId", async () => {
      mockBuildFeatureContext.mockResolvedValue({
        feature: {
          title: "Test Feature",
          brief: "Feature brief",
          userStories: ["Story 1", "Story 2"],
          requirements: "Feature requirements",
          architecture: "Architecture details",
        },
        currentPhase: {
          name: "Implementation",
          description: "Implementation phase",
          tickets: [
            { id: "ticket-1", title: "Ticket 1", description: "Desc 1", status: "TODO" },
          ],
        },
      });


      // Setup task with featureId and phaseId
      TestHelpers.setupTaskCreate();
      mockDb.task.create.mockImplementation((params: any) => {
        return Promise.resolve({
          ...TestDataFactory.createValidTask({
            featureId: "feature-123",
            phaseId: "phase-456",
          }),
          title: params.data.title,
          description: params.data.description,
          featureId: "feature-123",
          phaseId: "phase-456",
        } as any);
      });

      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupTaskStatusCheck("TODO");
      TestHelpers.setupTaskUpdate();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
      });

      // Verify buildFeatureContext was called with correct IDs
      expect(mockBuildFeatureContext).toHaveBeenCalledWith("feature-123", "phase-456");

      // Verify feature context was included in Stakwork payload
      TestHelpers.expectStakworkCalledWithVars({
        featureContext: {
          feature: {
            title: "Test Feature",
            brief: "Feature brief",
            userStories: ["Story 1", "Story 2"],
            requirements: "Feature requirements",
            architecture: "Architecture details",
          },
          currentPhase: {
            name: "Implementation",
            description: "Implementation phase",
            tickets: [
              { id: "ticket-1", title: "Ticket 1", description: "Desc 1", status: "TODO" },
            ],
          },
        },
      });
    });

    test("should continue without feature context when buildFeatureContext fails", async () => {
      mockBuildFeatureContext.mockRejectedValue(new Error("Feature context error"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});


      TestHelpers.setupTaskCreate();
      mockDb.task.create.mockImplementation((params: any) => {
        return Promise.resolve({
          ...TestDataFactory.createValidTask({
            featureId: "feature-123",
            phaseId: "phase-456",
          }),
          featureId: "feature-123",
          phaseId: "phase-456",
        } as any);
      });

      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupTaskStatusCheck("TODO");
      TestHelpers.setupTaskUpdate();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error building feature context:",
        expect.any(Error)
      );

      // Verify Stakwork was still called without feature context
      TestHelpers.expectStakworkCalled();

      consoleErrorSpy.mockRestore();
    });

    test("should not call buildFeatureContext when task has no featureId", async () => {
      // mockBuildFeatureContext is already mocked at module level


      TestHelpers.setupTaskCreate();
      mockDb.task.create.mockImplementation((params: any) => {
        return Promise.resolve({
          ...TestDataFactory.createValidTask(),
          featureId: null,
          phaseId: "phase-456",
        } as any);
      });

      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupTaskStatusCheck("TODO");
      TestHelpers.setupTaskUpdate();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
      });

      expect(mockBuildFeatureContext).not.toHaveBeenCalled();
    });

    test("should not call buildFeatureContext when task has no phaseId", async () => {
      // mockBuildFeatureContext is already mocked at module level


      TestHelpers.setupTaskCreate();
      mockDb.task.create.mockImplementation((params: any) => {
        return Promise.resolve({
          ...TestDataFactory.createValidTask(),
          featureId: "feature-123",
          phaseId: null,
        } as any);
      });

      TestHelpers.setupValidUser();
      TestHelpers.setupValidChatMessage();
      TestHelpers.setupValidGithubProfile();
      TestHelpers.setupTaskStatusCheck("TODO");
      TestHelpers.setupTaskUpdate();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      await createTaskWithStakworkWorkflow({
        title: "New Task",
        description: "Task Description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM" as Priority,
        userId: "test-user-id",
      });

      expect(mockBuildFeatureContext).not.toHaveBeenCalled();
    });
  });

  describe("via sendMessageToStakwork", () => {
    test("should include provided featureContext in Stakwork payload", async () => {
      MockSetup.setupSuccessfulWorkflow();

      const featureContext = {
        feature: {
          title: "Authentication Feature",
          brief: "User authentication system",
          userStories: ["As a user, I can log in"],
          requirements: "Secure authentication",
          architecture: "OAuth 2.0",
        },
        currentPhase: {
          name: "Testing",
          description: "Testing phase",
          tickets: [],
        },
      };

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
        featureContext,
      });

      TestHelpers.expectStakworkCalledWithVars({
        featureContext,
      });
    });

    test("should not include featureContext when not provided", async () => {
      MockSetup.setupSuccessfulWorkflow();

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.featureContext).toBeUndefined();
    });
  });
});

describe("Repository Configuration Handling", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should extract repository URL and branch from workspace repositories", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const taskWithRepo = TestDataFactory.createValidTask({
      workspace: {
        id: "test-workspace-id",
        slug: "test-workspace",
        swarm: {
          id: "swarm-id",
          swarmUrl: "https://test-swarm.example.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolName: "test-pool",
          name: "test-swarm",
        },
        repositories: [
          {
            repositoryUrl: "https://github.com/test/repo",
            branch: "main",
          },
        ],
      },
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithRepo as any);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      repo_url: "https://github.com/test/repo",
      base_branch: "main",
    });
  });

  test("should handle workspace with no repositories", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const taskWithoutRepo = TestDataFactory.createValidTask({
      workspace: {
        id: "test-workspace-id",
        slug: "test-workspace",
        swarm: {
          id: "swarm-id",
          swarmUrl: "https://test-swarm.example.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolName: "test-pool",
          name: "test-swarm",
        },
        repositories: [],
      },
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithoutRepo as any);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      repo_url: null,
      base_branch: null,
    });
  });

  test("should use most recent repository when multiple exist", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const taskWithMultipleRepos = TestDataFactory.createValidTask({
      workspace: {
        id: "test-workspace-id",
        slug: "test-workspace",
        swarm: {
          id: "swarm-id",
          swarmUrl: "https://test-swarm.example.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolName: "test-pool",
          name: "test-swarm",
        },
        repositories: [
          {
            repositoryUrl: "https://github.com/test/newest-repo",
            branch: "develop",
          },
        ],
      },
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithMultipleRepos as any);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      repo_url: "https://github.com/test/newest-repo",
      base_branch: "develop",
    });
  });
});

describe("Workspace Configuration Validation", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should handle workspace with null swarm configuration", async () => {
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();

    const taskWithNullSwarm = TestDataFactory.createValidTask({
      workspace: {
        id: "test-workspace-id",
        slug: "test-workspace",
        swarm: null,
        repositories: [],
      },
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithNullSwarm as any);

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
      swarmUrl: "",
      swarmSecretAlias: null,
      poolName: null,
      repo2graph_url: "",
    });
  });

  test("should transform swarmUrl correctly for workflow API", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const taskWithSwarmUrl = TestDataFactory.createValidTask({
      workspace: {
        id: "test-workspace-id",
        slug: "test-workspace",
        swarm: {
          id: "swarm-id",
          swarmUrl: "https://custom-swarm.example.com/api",
          swarmSecretAlias: "{{CUSTOM_SECRET}}",
          poolName: "custom-pool",
          name: "custom-swarm",
        },
        repositories: [],
      },
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithSwarmUrl as any);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      swarmUrl: "https://custom-swarm.example.com:8444/api",
      repo2graph_url: "https://custom-swarm.example.com:3355",
    });
  });

  test("should use swarm ID as poolName", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      poolName: "swarm-id",
    });
  });
});

describe("Task Status Consistency", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should not update task status when already IN_PROGRESS", async () => {
    TestHelpers.setupValidTask();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupTaskStatusCheck("IN_PROGRESS");
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

    const updateCall = mockDb.task.update.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
    expect(updateCall.data.workflowStatus).toBe("IN_PROGRESS");
  });

  test("should not update task status when already DONE", async () => {
    TestHelpers.setupValidTask();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupTaskStatusCheck("DONE");
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

    const updateCall = mockDb.task.update.mock.calls[0][0];
    expect(updateCall.data.status).toBeUndefined();
  });

  test("should update task status from TODO to IN_PROGRESS on successful workflow start", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    const updateCall = mockDb.task.update.mock.calls[0][0];
    expect(updateCall.data.status).toBe("IN_PROGRESS");
    expect(updateCall.data.workflowStatus).toBe("IN_PROGRESS");
  });
});

describe("Timestamp and Metadata Handling", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should set workflowStartedAt to current timestamp", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const beforeTime = new Date();
    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });
    const afterTime = new Date();

    const updateCall = mockDb.task.update.mock.calls[0][0];
    const startedAt = updateCall.data.workflowStartedAt;

    expect(startedAt).toBeInstanceOf(Date);
    expect(startedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    expect(startedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
  });

  test("should store stakworkProjectId from Stakwork response", async () => {
    MockSetup.setupSuccessfulWorkflow(12345);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    const updateCall = mockDb.task.update.mock.calls[0][0];
    expect(updateCall.data.stakworkProjectId).toBe(12345);
  });

  test("should log warning when project_id missing in success response", async () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    TestHelpers.setupValidTask();
    TestHelpers.setupValidUser();
    TestHelpers.setupValidChatMessage();
    TestHelpers.setupValidGithubProfile();
    TestHelpers.setupTaskStatusCheck("TODO");
    TestHelpers.setupTaskUpdate();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: {} }),
    } as Response);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "No project_id found in Stakwork response:",
      expect.objectContaining({ success: true })
    );

    const updateCall = mockDb.task.update.mock.calls[0][0];
    expect(updateCall.data.stakworkProjectId).toBeUndefined();
    expect(updateCall.data.workflowStatus).toBe("IN_PROGRESS");

    consoleWarnSpy.mockRestore();
  });

  test("should include workspaceId in Stakwork payload", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      workspaceId: "test-workspace-id",
    });
  });

  test("should include runBuild and runTestSuite flags in Stakwork payload", async () => {
    MockSetup.setupSuccessfulWorkflow();

    const taskWithFlags = TestDataFactory.createValidTask({
      runBuild: false,
      runTestSuite: false,
    });

    mockDb.task.findFirst.mockResolvedValue(taskWithFlags as any);

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    TestHelpers.expectStakworkCalledWithVars({
      runBuild: false,
      runTestSuite: false,
    });
  });
});

describe("generateChatTitle Parameter Handling", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should include generateChatTitle when explicitly set to true", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
      generateChatTitle: true,
    });

    TestHelpers.expectStakworkCalledWithVars({
      generateChatTitle: true,
    });
  });

  test("should include generateChatTitle when explicitly set to false", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
      generateChatTitle: false,
    });

    TestHelpers.expectStakworkCalledWithVars({
      generateChatTitle: false,
    });
  });

  test("should not include generateChatTitle when not provided", async () => {
    MockSetup.setupSuccessfulWorkflow();

    await sendMessageToStakwork({
      taskId: "test-task-id",
      message: "Test message",
      userId: "test-user-id",
    });

    const fetchCall = mockFetch.mock.calls[0];
    const payload = JSON.parse(fetchCall[1]?.body as string);
    const vars = payload.workflow_params.set_var.attributes.vars;

    expect(vars.generateChatTitle).toBeUndefined();
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

describe("callStakworkAPI - Direct Unit Tests", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Payload Construction", () => {
    test("should construct correct webhook URLs", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        taskId: "task-123",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        webhook_url: "http://localhost:3000/api/stakwork/webhook?task_id=task-123",
        vars: {
          webhookUrl: "http://localhost:3000/api/chat/response",
        },
      });
    });

    test("should construct vars object with all required fields", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        taskId: "task-456",
        message: "Custom message",
        contextTags: [{ type: "file", value: "test.ts" }],
        userName: "johndoe",
        accessToken: "token-abc",
        swarmUrl: "https://custom-swarm.com:8444/api",
        swarmSecretAlias: "{{CUSTOM_SECRET}}",
        poolName: "custom-pool",
        repo2GraphUrl: "https://custom-swarm.com:3355",
        attachments: ["/uploads/file1.pdf"],
        mode: "live",
        taskSource: "JANITOR",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          taskId: "task-456",
          message: "Custom message",
          contextTags: [{ type: "file", value: "test.ts" }],
          alias: "johndoe",
          username: "johndoe",
          accessToken: "token-abc",
          swarmUrl: "https://custom-swarm.com:8444/api",
          swarmSecretAlias: "{{CUSTOM_SECRET}}",
          poolName: "custom-pool",
          repo2graph_url: "https://custom-swarm.com:3355",
          attachments: ["/uploads/file1.pdf"],
          taskMode: "live",
          taskSource: "janitor",
        },
      });
    });

    test("should set payload name to 'hive_autogen'", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]?.body as string);
      expect(payload.name).toBe("hive_autogen");
    });

    test("should normalize taskSource to lowercase", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        taskSource: "JANITOR",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          taskSource: "janitor",
        },
      });
    });
  });

  describe("Workflow Mode Selection", () => {
    test("should use workflow ID at index 0 for 'live' mode", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        mode: "live",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        workflow_id: 123, // First ID in "123,456,789"
      });
    });

    test("should use workflow ID at index 1 for 'default' mode", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        mode: "default",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        workflow_id: 456, // Second ID in "123,456,789"
      });
    });

    test("should use workflow ID at index 1 for 'test' mode", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        mode: "test",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        workflow_id: 456, // Second ID in "123,456,789"
      });
    });

    test("should use workflow ID at index 2 for 'unit' mode", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        mode: "unit",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        workflow_id: 789, // Third ID in "123,456,789"
      });
    });

    test("should use workflow ID at index 2 for 'integration' mode", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        mode: "integration",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        workflow_id: 789, // Third ID in "123,456,789"
      });
    });

    test("should fallback to workflow ID at index 1 for unknown mode", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        mode: "unknown-mode",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        workflow_id: 456, // Second ID as fallback
      });
    });
  });

  describe("HTTP Request Configuration", () => {
    test("should send POST request to correct endpoint", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://test-stakwork.com/projects",
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    test("should include correct authorization header", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Authorization: "Token token=test-api-key",
            "Content-Type": "application/json",
          },
        })
      );
    });

    test("should send JSON payload in request body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      const fetchCall = mockFetch.mock.calls[0];
      const body = fetchCall[1]?.body as string;
      
      expect(() => JSON.parse(body)).not.toThrow();
      const payload = JSON.parse(body);
      expect(payload).toHaveProperty("workflow_id");
      expect(payload).toHaveProperty("workflow_params");
    });
  });

  describe("Successful API Responses", () => {
    test("should return success: true with project_id on successful response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(12345),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      const result = await callStakworkAPI(params);

      expect(result).toEqual({
        success: true,
        data: { project_id: 12345 },
      });
    });

    test("should return success: true without project_id", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      const result = await callStakworkAPI(params);

      expect(result).toEqual({
        success: true,
        data: {},
      });
    });

    test("should parse JSON response correctly", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            project_id: 999,
            additional_field: "extra_data",
          },
        }),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      const result = await callStakworkAPI(params);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        project_id: 999,
        additional_field: "extra_data",
      });
    });
  });

  describe("Error Handling - HTTP Errors", () => {
    test("should return error on 400 Bad Request", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Bad Request",
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      const result = await callStakworkAPI(params);

      expect(result).toEqual({
        success: false,
        error: "Bad Request",
      });
    });

    test("should return error on 401 Unauthorized", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Unauthorized",
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      const result = await callStakworkAPI(params);

      expect(result).toEqual({
        success: false,
        error: "Unauthorized",
      });
    });

    test("should return error on 404 Not Found", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Not Found",
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      const result = await callStakworkAPI(params);

      expect(result).toEqual({
        success: false,
        error: "Not Found",
      });
    });

    test("should return error on 500 Internal Server Error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      const result = await callStakworkAPI(params);

      expect(result).toEqual({
        success: false,
        error: "Internal Server Error",
      });
    });

    test("should log error message to console on HTTP error", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Service Unavailable",
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Failed to send message to Stakwork: Service Unavailable"
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Error Handling - Network Errors", () => {
    test("should handle fetch network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network connection failed"));

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");

      const result = await callStakworkAPI(params);

      expect(result).toEqual({
        success: false,
        error: "Error: Network connection failed",
      });
    });

    test("should handle fetch timeout error", async () => {
      mockFetch.mockRejectedValue(new Error("Request timeout"));

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");

      const result = await callStakworkAPI(params);

      expect(result).toEqual({
        success: false,
        error: "Error: Request timeout",
      });
    });

    test("should handle JSON parsing error", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");

      const result = await callStakworkAPI(params);

      expect(result).toEqual({
        success: false,
        error: "Error: Invalid JSON",
      });
    });
  });

  describe("Configuration Validation", () => {
    test("should throw error when STAKWORK_API_KEY is missing", async () => {
      vi.mocked(mockConfig).STAKWORK_API_KEY = "";

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      
      await expect(callStakworkAPI(params)).rejects.toThrow("Stakwork configuration missing");
    });

    test("should throw error when STAKWORK_API_KEY is undefined", async () => {
      vi.mocked(mockConfig).STAKWORK_API_KEY = undefined as any;

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      
      await expect(callStakworkAPI(params)).rejects.toThrow("Stakwork configuration missing");
    });

    test("should throw error when STAKWORK_WORKFLOW_ID is missing", async () => {
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "";

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      
      await expect(callStakworkAPI(params)).rejects.toThrow("Stakwork configuration missing");
    });

    test("should throw error when STAKWORK_WORKFLOW_ID is undefined", async () => {
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = undefined as any;

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      
      await expect(callStakworkAPI(params)).rejects.toThrow("Stakwork configuration missing");
    });

    test("should not throw when all required config is present", async () => {
      vi.mocked(mockConfig).STAKWORK_API_KEY = "test-api-key";
      vi.mocked(mockConfig).STAKWORK_BASE_URL = "https://test-stakwork.com";
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "123,456,789";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams();

      const { callStakworkAPI } = await import("@/services/task-workflow");
      
      await expect(callStakworkAPI(params)).resolves.toBeDefined();
    });
  });

  describe("GitHub Credentials Handling", () => {
    test("should include GitHub credentials when provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        userName: "githubuser",
        accessToken: "github_pat_token123",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          alias: "githubuser",
          username: "githubuser",
          accessToken: "github_pat_token123",
        },
      });
    });

    test("should handle null userName", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        userName: null,
        accessToken: "token123",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          alias: null,
          username: null,
          accessToken: "token123",
        },
      });
    });

    test("should handle null accessToken", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        userName: "githubuser",
        accessToken: null,
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          alias: "githubuser",
          username: "githubuser",
          accessToken: null,
        },
      });
    });

    test("should handle both null userName and accessToken", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        userName: null,
        accessToken: null,
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          alias: null,
          username: null,
          accessToken: null,
        },
      });
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty contextTags array", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        contextTags: [],
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          contextTags: [],
        },
      });
    });

    test("should handle empty attachments array", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        attachments: [],
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          attachments: [],
        },
      });
    });

    test("should handle very long message content", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const longMessage = "a".repeat(10000);
      const params = TestDataFactory.createCallStakworkAPIParams({
        message: longMessage,
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          message: longMessage,
        },
      });
    });

    test("should handle special characters in message", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const specialMessage = "Test with 🚀 emojis and special chars: àáâäåæçèéêë & <html> tags";
      const params = TestDataFactory.createCallStakworkAPIParams({
        message: specialMessage,
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          message: specialMessage,
        },
      });
    });

    test("should handle empty swarmUrl", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        swarmUrl: "",
        repo2GraphUrl: "",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          swarmUrl: "",
          repo2graph_url: "",
        },
      });
    });

    test("should handle multiple attachments", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const attachments = [
        "/uploads/file1.pdf",
        "/uploads/file2.jpg",
        "/uploads/file3.doc",
      ];
      const params = TestDataFactory.createCallStakworkAPIParams({
        attachments,
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          attachments,
        },
      });
    });

    test("should handle complex contextTags structure", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const contextTags = [
        { type: "file", value: "src/app.ts" },
        { type: "folder", value: "src/" },
        { type: "feature", value: "authentication" },
      ];
      const params = TestDataFactory.createCallStakworkAPIParams({
        contextTags,
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        vars: {
          contextTags,
        },
      });
    });
  });

  describe("Workflow ID Parsing", () => {
    test("should parse comma-separated workflow IDs correctly", async () => {
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "111,222,333";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        mode: "live",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        workflow_id: 111,
      });
    });

    test("should handle workflow ID string with spaces", async () => {
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = " 111 , 222 , 333 ";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        mode: "unit",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        workflow_id: 333,
      });
    });

    test("should fallback to first ID when only one workflow ID provided", async () => {
      vi.mocked(mockConfig).STAKWORK_WORKFLOW_ID = "999";

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => TestDataFactory.createStakworkSuccessResponse(),
      } as Response);

      const params = TestDataFactory.createCallStakworkAPIParams({
        mode: "default",
      });

      const { callStakworkAPI } = await import("@/services/task-workflow");
      await callStakworkAPI(params);

      TestHelpers.expectCallStakworkAPIPayload({
        workflow_id: 999,
      });
    });
  });
});

// ============================================================================
// callStakworkAPI Unit Tests
// ============================================================================
// NOTE: These tests are commented out because they test a non-existent API signature.
// The actual callStakworkAPI function accepts an object parameter with properties like
// taskId, message, userName, etc., not (endpoint, method, body) parameters.
// These tests need to be rewritten to match the actual implementation in
// src/services/task-workflow.ts or a new simpler wrapper function needs to be created.
// See: https://github.com/[repo]/issues/[number] for tracking.
/*
describe("callStakworkAPI", () => {
  // Test Data Factory for callStakworkAPI
  const CallStakworkAPIDataFactory = {
    createValidPayload: (overrides = {}) => ({
      endpoint: "/api/projects",
      method: "POST" as const,
      body: {
        name: "Test Project",
        description: "Test Description",
      },
      ...overrides,
    }),

    createSuccessResponse: (overrides = {}) => ({
      success: true,
      data: {
        project_id: 12345,
        status: "created",
        message: "Project created successfully",
      },
      ...overrides,
    }),

    createErrorResponse: (overrides = {}) => ({
      success: false,
      error: "API request failed",
      message: "Invalid parameters",
      ...overrides,
    }),

    createValidationErrorResponse: () => ({
      success: false,
      error: "Validation failed",
      errors: [
        { field: "name", message: "Name is required" },
        { field: "description", message: "Description must be at least 10 characters" },
      ],
    }),

    createRateLimitResponse: () => ({
      success: false,
      error: "Rate limit exceeded",
      retryAfter: 60,
    }),

    createAuthErrorResponse: () => ({
      success: false,
      error: "Authentication failed",
      message: "Invalid or expired API key",
    }),
  };

  // Test Helpers for callStakworkAPI
  const CallStakworkAPIHelpers = {
    setupSuccessfulFetch: (responseData: any) => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => responseData,
        headers: new Headers({ "content-type": "application/json" }),
      });
      global.fetch = mockFetch;
      return mockFetch;
    },

    setupFailedFetch: (status: number, responseData: any) => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => responseData,
        statusText: `HTTP ${status}`,
        headers: new Headers({ "content-type": "application/json" }),
      });
      global.fetch = mockFetch;
      return mockFetch;
    },

    setupNetworkError: (errorMessage = "Network request failed") => {
      const mockFetch = vi.fn().mockRejectedValue(new Error(errorMessage));
      global.fetch = mockFetch;
      return mockFetch;
    },

    setupTimeoutError: () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("Request timeout"));
      global.fetch = mockFetch;
      return mockFetch;
    },

    setupInvalidJsonResponse: () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Invalid JSON");
        },
        headers: new Headers({ "content-type": "application/json" }),
      });
      global.fetch = mockFetch;
      return mockFetch;
    },

    expectFetchCalledWith: (
      mockFetch: any,
      expectedUrl: string,
      expectedOptions: any
    ) => {
      expect(mockFetch).toHaveBeenCalledWith(expectedUrl, expectedOptions);
    },

    expectFetchCalledOnce: (mockFetch: any) => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    },

    expectFetchNotCalled: (mockFetch: any) => {
      expect(mockFetch).not.toHaveBeenCalled();
    },
  };

  // Mock Setup for callStakworkAPI
  const CallStakworkAPIMockSetup = {
    setupSuccessScenario: () => {
      const responseData = CallStakworkAPIDataFactory.createSuccessResponse();
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(responseData);
      return { mockFetch, responseData };
    },

    setupErrorScenario: (status = 400) => {
      const responseData = CallStakworkAPIDataFactory.createErrorResponse();
      const mockFetch = CallStakworkAPIHelpers.setupFailedFetch(status, responseData);
      return { mockFetch, responseData };
    },

    setupNetworkErrorScenario: () => {
      const mockFetch = CallStakworkAPIHelpers.setupNetworkError();
      return { mockFetch };
    },

    reset: () => {
      vi.clearAllMocks();
      if (global.fetch) {
        vi.mocked(global.fetch).mockClear();
      }
    },
  };

  beforeEach(() => {
    CallStakworkAPIMockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Successful API Calls", () => {
    test("should successfully call Stakwork API with valid payload", async () => {
      const { mockFetch, responseData } = CallStakworkAPIMockSetup.setupSuccessScenario();
      const payload = CallStakworkAPIDataFactory.createValidPayload();

      const result = await callStakworkAPI(
        payload.endpoint,
        payload.method,
        payload.body
      );

      expect(result).toEqual(responseData);
      CallStakworkAPIHelpers.expectFetchCalledOnce(mockFetch);
    });

    test("should handle POST requests with valid data", async () => {
      const responseData = CallStakworkAPIDataFactory.createSuccessResponse({
        data: { project_id: 99999 },
      });
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(responseData);

      const result = await callStakworkAPI("/api/projects", "POST", {
        name: "New Project",
        description: "Project description",
      });

      expect(result.success).toBe(true);
      expect(result.data.project_id).toBe(99999);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/projects"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("should handle GET requests without body", async () => {
      const responseData = CallStakworkAPIDataFactory.createSuccessResponse();
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(responseData);

      const result = await callStakworkAPI("/api/projects/123", "GET");

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/projects/123"),
        expect.objectContaining({
          method: "GET",
        })
      );
    });

    test("should handle PUT requests with update data", async () => {
      const responseData = CallStakworkAPIDataFactory.createSuccessResponse({
        data: { updated: true },
      });
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(responseData);

      const result = await callStakworkAPI("/api/projects/123", "PUT", {
        status: "completed",
      });

      expect(result.success).toBe(true);
      expect(result.data.updated).toBe(true);
    });

    test("should handle DELETE requests", async () => {
      const responseData = CallStakworkAPIDataFactory.createSuccessResponse({
        data: { deleted: true },
      });
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(responseData);

      const result = await callStakworkAPI("/api/projects/123", "DELETE");

      expect(result.success).toBe(true);
      expect(result.data.deleted).toBe(true);
    });

    test("should include API key in request headers", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      await callStakworkAPI("/api/projects", "POST", { name: "Test" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Bearer"),
          }),
        })
      );
    });
  });

  describe("HTTP Error Responses", () => {
    test("should handle 400 Bad Request errors", async () => {
      const { mockFetch, responseData } = CallStakworkAPIMockSetup.setupErrorScenario(400);

      const result = await callStakworkAPI("/api/projects", "POST", {
        name: "",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      CallStakworkAPIHelpers.expectFetchCalledOnce(mockFetch);
    });

    test("should handle 401 Unauthorized errors", async () => {
      const responseData = CallStakworkAPIDataFactory.createAuthErrorResponse();
      const mockFetch = CallStakworkAPIHelpers.setupFailedFetch(401, responseData);

      const result = await callStakworkAPI("/api/projects", "GET");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Authentication failed");
    });

    test("should handle 403 Forbidden errors", async () => {
      const responseData = CallStakworkAPIDataFactory.createErrorResponse({
        error: "Forbidden",
        message: "Insufficient permissions",
      });
      const mockFetch = CallStakworkAPIHelpers.setupFailedFetch(403, responseData);

      const result = await callStakworkAPI("/api/projects/123", "DELETE");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Forbidden");
    });

    test("should handle 404 Not Found errors", async () => {
      const responseData = CallStakworkAPIDataFactory.createErrorResponse({
        error: "Not Found",
        message: "Project not found",
      });
      const mockFetch = CallStakworkAPIHelpers.setupFailedFetch(404, responseData);

      const result = await callStakworkAPI("/api/projects/999", "GET");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Not Found");
    });

    test("should handle 422 Validation errors", async () => {
      const responseData = CallStakworkAPIDataFactory.createValidationErrorResponse();
      const mockFetch = CallStakworkAPIHelpers.setupFailedFetch(422, responseData);

      const result = await callStakworkAPI("/api/projects", "POST", {
        name: "",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Validation failed");
    });

    test("should handle 429 Rate Limit errors", async () => {
      const responseData = CallStakworkAPIDataFactory.createRateLimitResponse();
      const mockFetch = CallStakworkAPIHelpers.setupFailedFetch(429, responseData);

      const result = await callStakworkAPI("/api/projects", "POST", {
        name: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Rate limit exceeded");
    });

    test("should handle 500 Internal Server errors", async () => {
      const responseData = CallStakworkAPIDataFactory.createErrorResponse({
        error: "Internal Server Error",
        message: "An unexpected error occurred",
      });
      const mockFetch = CallStakworkAPIHelpers.setupFailedFetch(500, responseData);

      const result = await callStakworkAPI("/api/projects", "POST", {
        name: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Internal Server Error");
    });

    test("should handle 503 Service Unavailable errors", async () => {
      const responseData = CallStakworkAPIDataFactory.createErrorResponse({
        error: "Service Unavailable",
        message: "Service is temporarily unavailable",
      });
      const mockFetch = CallStakworkAPIHelpers.setupFailedFetch(503, responseData);

      const result = await callStakworkAPI("/api/projects", "GET");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Service Unavailable");
    });
  });

  describe("Network Failures", () => {
    test("should handle network connection errors", async () => {
      const { mockFetch } = CallStakworkAPIMockSetup.setupNetworkErrorScenario();

      await expect(
        callStakworkAPI("/api/projects", "POST", { name: "Test" })
      ).rejects.toThrow("Network request failed");

      CallStakworkAPIHelpers.expectFetchCalledOnce(mockFetch);
    });

    test("should handle timeout errors", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupTimeoutError();

      await expect(
        callStakworkAPI("/api/projects", "POST", { name: "Test" })
      ).rejects.toThrow("Request timeout");

      CallStakworkAPIHelpers.expectFetchCalledOnce(mockFetch);
    });

    test("should handle DNS resolution failures", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupNetworkError(
        "getaddrinfo ENOTFOUND"
      );

      await expect(
        callStakworkAPI("/api/projects", "POST", { name: "Test" })
      ).rejects.toThrow();
    });

    test("should handle connection refused errors", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupNetworkError("connect ECONNREFUSED");

      await expect(
        callStakworkAPI("/api/projects", "POST", { name: "Test" })
      ).rejects.toThrow();
    });
  });

  describe("Invalid Responses", () => {
    test("should handle invalid JSON response", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupInvalidJsonResponse();

      await expect(
        callStakworkAPI("/api/projects", "POST", { name: "Test" })
      ).rejects.toThrow("Invalid JSON");
    });

    test("should handle empty response body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => null,
        headers: new Headers({ "content-type": "application/json" }),
      });
      global.fetch = mockFetch;

      const result = await callStakworkAPI("/api/projects", "POST", {
        name: "Test",
      });

      expect(result).toBeNull();
    });

    test("should handle malformed JSON response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "{ invalid json }{",
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
        headers: new Headers({ "content-type": "application/json" }),
      });
      global.fetch = mockFetch;

      await expect(
        callStakworkAPI("/api/projects", "POST", { name: "Test" })
      ).rejects.toThrow();
    });
  });

  describe("Request Configuration", () => {
    test("should throw error when API base URL is not configured", async () => {
      // Mock missing environment variable
      vi.mocked(env.STAKWORK_BASE_URL).mockReturnValue(undefined);

      await expect(
        callStakworkAPI("/api/projects", "POST", { name: "Test" })
      ).rejects.toThrow();
    });

    test("should throw error when API key is not configured", async () => {
      // Mock missing API key
      vi.mocked(env.STAKWORK_API_KEY).mockReturnValue(undefined);

      await expect(
        callStakworkAPI("/api/projects", "POST", { name: "Test" })
      ).rejects.toThrow();
    });

    test("should construct correct API URL with base URL and endpoint", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      await callStakworkAPI("/api/projects", "POST", { name: "Test" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/^https?:\/\/.+\/api\/projects$/),
        expect.any(Object)
      );
    });

    test("should handle trailing slashes in base URL and endpoint", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      await callStakworkAPI("/api/projects/", "POST", { name: "Test" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/projects/),
        expect.any(Object)
      );
    });
  });

  describe("Request Headers and Body", () => {
    test("should set correct Content-Type header for JSON requests", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      await callStakworkAPI("/api/projects", "POST", { name: "Test" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("should stringify request body for POST requests", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      const requestBody = { name: "Test Project", description: "Test" };
      await callStakworkAPI("/api/projects", "POST", requestBody);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(requestBody),
        })
      );
    });

    test("should not include body for GET requests", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      await callStakworkAPI("/api/projects", "GET");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          body: expect.anything(),
        })
      );
    });

    test("should handle complex nested request bodies", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      const complexBody = {
        project: {
          name: "Test",
          settings: {
            visibility: "private",
            features: ["feature1", "feature2"],
          },
          metadata: {
            tags: ["tag1", "tag2"],
          },
        },
      };

      await callStakworkAPI("/api/projects", "POST", complexBody);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(complexBody),
        })
      );
    });
  });

  describe("Response Data Validation", () => {
    test("should return response with success flag", async () => {
      const responseData = CallStakworkAPIDataFactory.createSuccessResponse();
      CallStakworkAPIHelpers.setupSuccessfulFetch(responseData);

      const result = await callStakworkAPI("/api/projects", "POST", {
        name: "Test",
      });

      expect(result).toHaveProperty("success");
      expect(result.success).toBe(true);
    });

    test("should return response with data payload", async () => {
      const responseData = CallStakworkAPIDataFactory.createSuccessResponse({
        data: { project_id: 12345, status: "active" },
      });
      CallStakworkAPIHelpers.setupSuccessfulFetch(responseData);

      const result = await callStakworkAPI("/api/projects", "POST", {
        name: "Test",
      });

      expect(result).toHaveProperty("data");
      expect(result.data.project_id).toBe(12345);
      expect(result.data.status).toBe("active");
    });

    test("should return error details on failure", async () => {
      const responseData = CallStakworkAPIDataFactory.createErrorResponse({
        error: "Validation failed",
        message: "Name is required",
      });
      CallStakworkAPIHelpers.setupFailedFetch(400, responseData);

      const result = await callStakworkAPI("/api/projects", "POST", {
        name: "",
      });

      expect(result.success).toBe(false);
      expect(result).toHaveProperty("error");
      expect(result.error).toBe("Validation failed");
    });

    test("should preserve all response fields", async () => {
      const responseData = {
        success: true,
        data: { project_id: 123 },
        message: "Created successfully",
        timestamp: "2024-01-01T00:00:00Z",
      };
      CallStakworkAPIHelpers.setupSuccessfulFetch(responseData);

      const result = await callStakworkAPI("/api/projects", "POST", {
        name: "Test",
      });

      expect(result).toEqual(responseData);
    });
  });

  describe("Edge Cases", () => {
    test("should handle endpoint without leading slash", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      await callStakworkAPI("api/projects", "POST", { name: "Test" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/api\/projects/),
        expect.any(Object)
      );
    });

    test("should handle empty request body", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      await callStakworkAPI("/api/projects", "POST", {});

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({}),
        })
      );
    });

    test("should handle null request body", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      await callStakworkAPI("/api/projects", "POST", null);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(null),
        })
      );
    });

    test("should handle undefined request body", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      await callStakworkAPI("/api/projects", "POST", undefined);

      expect(mockFetch).toHaveBeenCalled();
    });

    test("should handle very long endpoint paths", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      const longPath = "/api/v1/workspaces/123/projects/456/tasks/789/comments/999";
      await callStakworkAPI(longPath, "GET");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(longPath),
        expect.any(Object)
      );
    });

    test("should handle special characters in request body", async () => {
      const mockFetch = CallStakworkAPIHelpers.setupSuccessfulFetch(
        CallStakworkAPIDataFactory.createSuccessResponse()
      );

      const specialCharsBody = {
        name: "Test <script>alert('xss')</script>",
        description: "Test & Co. © 2024",
        emoji: "🚀💻🎉",
      };

      await callStakworkAPI("/api/projects", "POST", specialCharsBody);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify(specialCharsBody),
        })
      );
    });
  });
});
*/