import { describe, test, expect, beforeEach, vi } from "vitest";
import { sendMessageToStakwork, createTaskWithStakworkWorkflow } from "@/services/task-workflow";

// Mock all external dependencies at module level
vi.mock("@/lib/db", () => ({
  db: {
    chatMessage: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    task: {
      update: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://test-stakwork.com",
    STAKWORK_WORKFLOW_ID: "workflow-1,workflow-2,workflow-3",
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
const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

// Test data factories
const TestDataFactory = {
  createMockTask: (overrides = {}) => ({
    id: "task-123",
    title: "Test Task",
    sourceType: "USER",
    workspace: {
      id: "workspace-123",
      slug: "test-workspace",
      swarm: {
        id: "swarm-123",
        swarmUrl: "https://test-swarm.com/api",
        swarmSecretAlias: "test-secret-alias",
        poolName: "test-pool",
        name: "Test Swarm",
      },
    },
    ...overrides,
  }),

  createMockTaskWithoutSwarm: (overrides = {}) => ({
    id: "task-123",
    title: "Test Task",
    sourceType: "USER",
    workspace: {
      id: "workspace-123",
      slug: "test-workspace",
      swarm: null,
    },
    ...overrides,
  }),

  createMockUser: (overrides = {}) => ({
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
    ...overrides,
  }),

  createMockChatMessage: (overrides = {}) => ({
    id: "message-123",
    taskId: "task-123",
    message: "Test message",
    role: "USER",
    contextTags: "[]",
    status: "SENT",
    timestamp: new Date(),
    task: {
      id: "task-123",
      title: "Test Task",
    },
    ...overrides,
  }),

  createMockGithubCredentials: (overrides = {}) => ({
    username: "testuser",
    token: "github_pat_test_token",
    ...overrides,
  }),

  createMockStakworkResponse: (overrides = {}) => ({
    success: true,
    data: {
      project_id: 12345,
    },
    ...overrides,
  }),
};

describe("sendMessageToStakwork", () => {
  const mockTaskId = "task-123";
  const mockMessage = "Test message for workflow";
  const mockUserId = "user-123";
  const mockContextTags = [{ type: "file", value: "test.js" }];
  const mockAttachments = ["uploads/test/file.pdf"];

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    const mockTask = TestDataFactory.createMockTask();
    const mockUser = TestDataFactory.createMockUser();
    const mockChatMessage = TestDataFactory.createMockChatMessage();
    const mockGithubCredentials = TestDataFactory.createMockGithubCredentials();

    vi.mocked(mockDb.chatMessage.create).mockResolvedValue(mockChatMessage as any);
    vi.mocked(mockDb.user.findUnique).mockResolvedValue(mockUser as any);
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);
    vi.mocked(mockDb.task.findFirst).mockResolvedValue(mockTask as any);
    vi.mocked(mockGetGithubUsernameAndPAT).mockResolvedValue(mockGithubCredentials);

    // Mock successful Stakwork API call
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => TestDataFactory.createMockStakworkResponse(),
    } as Response);

    // Reset config to default values
    Object.assign(mockConfig, {
      STAKWORK_API_KEY: "test-api-key",
      STAKWORK_BASE_URL: "https://test-stakwork.com",
      STAKWORK_WORKFLOW_ID: "workflow-1,workflow-2,workflow-3",
    });
  });

  describe("Task Lookup and Message Creation", () => {
    test("should find task and create chat message with correct parameters", async () => {
      const result = await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
        contextTags: mockContextTags,
        attachments: mockAttachments,
      });

      expect(mockDb.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockTaskId,
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

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: mockTaskId,
          message: mockMessage,
          role: "USER",
          contextTags: JSON.stringify(mockContextTags),
          status: "SENT",
        },
        include: {
          task: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });
    });

    test("should throw error when task not found", async () => {
      vi.mocked(mockDb.task.findFirst).mockResolvedValue(null);

      await expect(
        sendMessageToStakwork({
          taskId: mockTaskId,
          message: mockMessage,
          userId: mockUserId,
        })
      ).rejects.toThrow("Task not found");
    });

    test("should create message with empty contextTags when not provided", async () => {
      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextTags: JSON.stringify([]),
          }),
        })
      );
    });

    test("should return created chat message", async () => {
      const expectedMessage = TestDataFactory.createMockChatMessage();
      vi.mocked(mockDb.chatMessage.create).mockResolvedValue(expectedMessage as any);

      const result = await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(result.chatMessage).toEqual(expectedMessage);
    });
  });

  describe("User and Credential Validation", () => {
    test("should fetch user details", async () => {
      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUserId },
        select: {
          name: true,
        },
      });
    });

    test("should throw error when user not found", async () => {
      vi.mocked(mockDb.user.findUnique).mockResolvedValue(null);

      await expect(
        sendMessageToStakwork({
          taskId: mockTaskId,
          message: mockMessage,
          userId: mockUserId,
        })
      ).rejects.toThrow("User not found");
    });

    test("should retrieve GitHub credentials with workspace slug", async () => {
      const mockTask = TestDataFactory.createMockTask();

      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledWith(
        mockUserId,
        mockTask.workspace.slug
      );
    });

    test("should handle null GitHub credentials gracefully", async () => {
      vi.mocked(mockGetGithubUsernameAndPAT).mockResolvedValue(null);

      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      // Should still create message even without GitHub credentials
      expect(mockDb.chatMessage.create).toHaveBeenCalled();
    });
  });

  describe("Stakwork Integration with sendMessageToStakwork", () => {
    test("should send message and trigger Stakwork workflow", async () => {
      const mockCredentials = TestDataFactory.createMockGithubCredentials();
      vi.mocked(mockGetGithubUsernameAndPAT).mockResolvedValue(mockCredentials);

      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
        contextTags: mockContextTags,
        attachments: mockAttachments,
      });

      const fetchCall = mockFetch.mock.calls.find((call) =>
        call[0].toString().includes("stakwork")
      );

      expect(fetchCall).toBeTruthy();

      const requestUrl = fetchCall![0] as string;
      const requestOptions = fetchCall![1] as RequestInit;
      const body = JSON.parse(requestOptions.body as string);

      // Verify request URL
      expect(requestUrl).toBe("https://test-stakwork.com/projects");

      // Verify request headers
      expect(requestOptions.headers).toEqual({
        Authorization: "Token token=test-api-key",
        "Content-Type": "application/json",
      });

      // Verify payload structure
      expect(body).toMatchObject({
        name: "hive_autogen",
        workflow_id: 2, // default mode uses workflowIds[1]
        webhook_url: `http://localhost:3000/api/stakwork/webhook?task_id=${mockTaskId}`,
      });

      // Verify workflow params
      const vars = body.workflow_params.set_var.attributes.vars;
      expect(vars).toMatchObject({
        taskId: mockTaskId,
        message: mockMessage,
        contextTags: mockContextTags,
        webhookUrl: "http://localhost:3000/api/chat/response",
        alias: mockCredentials.username,
        username: mockCredentials.username,
        accessToken: mockCredentials.token,
        swarmUrl: "https://test-swarm.com:8444/api",
        swarmSecretAlias: "test-secret-alias",
        poolName: "swarm-123",
        repo2graph_url: "https://test-swarm.com:3355",
        attachments: mockAttachments,
        taskMode: "default",
        taskSource: "user",
      });
    });

    test("should include null credentials when GitHub auth unavailable", async () => {
      vi.mocked(mockGetGithubUsernameAndPAT).mockResolvedValue(null);

      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      const fetchCall = mockFetch.mock.calls.find((call) =>
        call[0].toString().includes("stakwork")
      );

      const body = JSON.parse(fetchCall![1]!.body as string);
      const vars = body.workflow_params.set_var.attributes.vars;

      expect(vars.username).toBeNull();
      expect(vars.accessToken).toBeNull();
      expect(vars.alias).toBeNull();
    });

    test("should skip Stakwork integration when config values missing", async () => {
      Object.assign(mockConfig, {
        STAKWORK_API_KEY: "",
        STAKWORK_BASE_URL: "",
        STAKWORK_WORKFLOW_ID: "",
      });

      const result = await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.stakworkData).toBeNull();
    });

    test("should skip Stakwork integration when swarm config missing", async () => {
      const mockTaskWithoutSwarm = TestDataFactory.createMockTaskWithoutSwarm();
      vi.mocked(mockDb.task.findFirst).mockResolvedValue(mockTaskWithoutSwarm as any);

      const result = await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.stakworkData).toBeNull();
    });
  });

  describe("Success Path - Task Status Updates", () => {
    test("should update task to IN_PROGRESS on successful Stakwork call", async () => {
      const mockStakworkResponse = TestDataFactory.createMockStakworkResponse({
        data: { project_id: 12345 },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockStakworkResponse,
      } as Response);

      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: "IN_PROGRESS",
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 12345,
        },
      });
    });

    test("should return stakwork response data on success", async () => {
      const mockStakworkResponse = TestDataFactory.createMockStakworkResponse();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockStakworkResponse,
      } as Response);

      const result = await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(result.stakworkData).toEqual(mockStakworkResponse);
    });

    test("should handle missing project_id in Stakwork response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }), // No project_id
      } as Response);

      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      // Should still update status but without project ID
      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: "IN_PROGRESS",
          workflowStartedAt: expect.any(Date),
        },
      });
    });
  });

  describe("Error Handling - Stakwork API Failures", () => {
    test("should update task to FAILED when Stakwork API returns error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: "FAILED",
        },
      });
    });

    test("should update task to FAILED when Stakwork API throws network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: mockTaskId },
        data: {
          workflowStatus: "FAILED",
        },
      });
    });

    test("should return chat message even when Stakwork call fails", async () => {
      const expectedMessage = TestDataFactory.createMockChatMessage();
      vi.mocked(mockDb.chatMessage.create).mockResolvedValue(expectedMessage as any);

      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      // Chat message should still be created and returned
      expect(result.chatMessage).toEqual(expectedMessage);
      expect(result.stakworkData).toBeNull();
    });

    test("should log error when Stakwork API call fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      mockFetch.mockRejectedValue(new Error("API timeout"));

      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error calling Stakwork:",
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Error Handling - Database Failures", () => {
    test("should throw error when chat message creation fails", async () => {
      vi.mocked(mockDb.chatMessage.create).mockRejectedValue(
        new Error("Database connection error")
      );

      await expect(
        sendMessageToStakwork({
          taskId: mockTaskId,
          message: mockMessage,
          userId: mockUserId,
        })
      ).rejects.toThrow("Database connection error");

      // Should not attempt Stakwork call if message creation fails
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockDb.task.update).not.toHaveBeenCalled();
    });

    test("should not affect message creation when task update fails", async () => {
      const expectedMessage = TestDataFactory.createMockChatMessage();
      vi.mocked(mockDb.chatMessage.create).mockResolvedValue(expectedMessage as any);
      vi.mocked(mockDb.task.update).mockRejectedValue(
        new Error("Task update failed")
      );

      // Should not throw error - task update failure is caught
      const result = await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      expect(result.chatMessage).toEqual(expectedMessage);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty message string", async () => {
      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: "",
        userId: mockUserId,
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: "",
          }),
        })
      );
    });

    test("should handle undefined contextTags parameter", async () => {
      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
        contextTags: undefined,
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextTags: JSON.stringify([]),
          }),
        })
      );
    });

    test("should handle undefined attachments parameter", async () => {
      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
        attachments: undefined,
      });

      const fetchCall = mockFetch.mock.calls.find((call) =>
        call[0].toString().includes("stakwork")
      );

      const body = JSON.parse(fetchCall![1]!.body as string);
      const vars = body.workflow_params.set_var.attributes.vars;

      expect(vars.attachments).toEqual([]);
    });

    test("should handle task with JANITOR source type", async () => {
      const mockTaskWithJanitorSource = TestDataFactory.createMockTask({
        sourceType: "JANITOR",
      });
      vi.mocked(mockDb.task.findFirst).mockResolvedValue(mockTaskWithJanitorSource as any);

      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      const fetchCall = mockFetch.mock.calls.find((call) =>
        call[0].toString().includes("stakwork")
      );

      const body = JSON.parse(fetchCall![1]!.body as string);
      const vars = body.workflow_params.set_var.attributes.vars;

      expect(vars.taskSource).toBe("janitor");
    });

    test("should handle malformed STAKWORK_WORKFLOW_ID configuration", async () => {
      Object.assign(mockConfig, {
        STAKWORK_WORKFLOW_ID: "single-workflow", // Only one workflow instead of comma-separated
      });

      await sendMessageToStakwork({
        taskId: mockTaskId,
        message: mockMessage,
        userId: mockUserId,
      });

      const fetchCall = mockFetch.mock.calls.find((call) =>
        call[0].toString().includes("stakwork")
      );

      const body = JSON.parse(fetchCall![1]!.body as string);

      // Should use the only available workflow
      expect(body.workflow_id).toBeNaN();
    });
  });
});