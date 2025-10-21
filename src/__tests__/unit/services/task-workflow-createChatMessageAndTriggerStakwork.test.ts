import { describe, test, expect, beforeEach, vi } from "vitest";
import { ChatRole, ChatStatus, WorkflowStatus } from "@prisma/client";

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
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

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

// Import mocked modules
const { db: mockDb } = await import("@/lib/db");
const { config: mockConfig } = await import("@/lib/env");
const { getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
const mockFetch = fetch as vi.MockedFunction<typeof fetch>;

// Import the functions to test (must be after mocks)
const { createTaskWithStakworkWorkflow, sendMessageToStakwork } = await import("@/services/task-workflow");

// Helper function to create test data
function createMockTask(overrides = {}) {
  return {
    id: "test-task-id",
    title: "Test Task",
    workspaceId: "test-workspace-id",
    workspace: {
      id: "test-workspace-id",
      name: "Test Workspace",
      slug: "test-workspace",
      swarm: {
        id: "swarm-id",
        swarmUrl: "https://swarm.example.com/api",
        swarmSecretAlias: "test-alias",
        poolName: "test-pool",
        name: "test-swarm",
      },
    },
    sourceType: "USER",
    ...overrides,
  };
}

function createMockChatMessage(overrides = {}) {
  return {
    id: "message-id",
    taskId: "test-task-id",
    message: "Test message",
    role: ChatRole.USER,
    contextTags: "[]",
    status: ChatStatus.SENT,
    task: {
      id: "test-task-id",
      title: "Test Task",
    },
    timestamp: new Date(),
    ...overrides,
  };
}

function createMockUser() {
  return {
    id: "test-user-id",
    name: "Test User",
    email: "test@example.com",
  };
}

function createMockStakworkResponse(overrides = {}) {
  return {
    success: true,
    data: {
      project_id: 12345,
    },
    ...overrides,
  };
}

describe("createChatMessageAndTriggerStakwork", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    mockDb.chatMessage.create.mockResolvedValue(createMockChatMessage() as any);
    mockDb.user.findUnique.mockResolvedValue(createMockUser() as any);
    mockDb.task.create.mockResolvedValue(createMockTask() as any);
    mockDb.task.update.mockResolvedValue({} as any);
    mockDb.task.findFirst = vi.fn().mockResolvedValue(createMockTask() as any);
    mockDb.task.findUnique.mockResolvedValue({ status: "TODO" } as any);
    mockDb.workspace.findUnique = vi.fn().mockResolvedValue({
      id: "test-workspace-id",
      name: "Test Workspace",
      slug: "test-workspace",
      swarm: {
        id: "swarm-id",
        swarmUrl: "https://swarm.example.com/api",
        swarmSecretAlias: "test-alias",
        poolName: "test-pool",
        name: "test-swarm",
      },
    });

    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "github-token-123",
    });

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => createMockStakworkResponse(),
    } as Response);
  });

  describe("Message Creation", () => {
    test("should create chat message with correct data structure", async () => {
      const mockTask = createMockTask();

      // Since createChatMessageAndTriggerStakwork is internal, we test via sendMessageToStakwork
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message content",
        userId: "test-user-id",
        contextTags: [{ type: "file", value: "test.js" }],
        attachments: ["/uploads/test.pdf"],
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith({
        data: {
          taskId: "test-task-id",
          message: "Test message content",
          role: "USER",
          contextTags: JSON.stringify([{ type: "file", value: "test.js" }]),
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

    test("should create message with empty contextTags when not provided", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contextTags: JSON.stringify([]),
          }),
        })
      );
    });

    test("should handle database error during message creation", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);
      mockDb.chatMessage.create.mockRejectedValue(new Error("Database error"));

      await expect(
        sendMessageToStakwork({
          taskId: "test-task-id",
          message: "Test message",
          userId: "test-user-id",
        })
      ).rejects.toThrow("Database error");
    });
  });

  describe("GitHub Credential Handling", () => {
    test("should fetch GitHub credentials with workspace slug", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledWith("test-user-id", "test-workspace");
    });

    test("should handle null GitHub credentials gracefully", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);
      mockGetGithubUsernameAndPAT.mockResolvedValue(null);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      // Should still create message and call Stakwork with null credentials
      expect(mockDb.chatMessage.create).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalled();

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_params.set_var.attributes.vars.username).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.accessToken).toBeNull();
    });
  });

  describe("User Validation", () => {
    test("should throw error if user not found", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);
      mockDb.user.findUnique.mockResolvedValue(null);

      await expect(
        sendMessageToStakwork({
          taskId: "test-task-id",
          message: "Test message",
          userId: "test-user-id",
        })
      ).rejects.toThrow("User not found");
    });

    test("should fetch user details with correct userId", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { id: "test-user-id" },
        select: {
          name: true,
        },
      });
    });
  });

  describe("Stakwork API Integration", () => {
    test("should call Stakwork API with correct payload structure", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test workflow message",
        userId: "test-user-id",
        contextTags: [{ type: "feature", value: "auth" }],
        attachments: ["/uploads/doc.pdf"],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://stakwork.example.com/projects",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Token token=test-stakwork-key",
            "Content-Type": "application/json",
          },
        })
      );

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);

      expect(payload).toMatchObject({
        name: "hive_autogen",
        workflow_id: 456, // Default mode uses stakworkWorkflowIds[1]
        webhook_url: "http://localhost:3000/api/stakwork/webhook?task_id=test-task-id",
        workflow_params: {
          set_var: {
            attributes: {
              vars: {
                taskId: "test-task-id",
                message: "Test workflow message",
                contextTags: [{ type: "feature", value: "auth" }],
                webhookUrl: "http://localhost:3000/api/chat/response",
                alias: "testuser",
                username: "testuser",
                accessToken: "github-token-123",
                swarmUrl: "https://swarm.example.com:8444/api",
                swarmSecretAlias: "test-alias",
                poolName: "swarm-id",
                repo2graph_url: "https://swarm.example.com:3355",
                attachments: ["/uploads/doc.pdf"],
                taskMode: "default",
                taskSource: "user",
              },
            },
          },
        },
      });
    });

    test("should update task status to IN_PROGRESS on successful API call", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: "test-task-id" },
        data: {
          workflowStatus: "IN_PROGRESS",
          workflowStartedAt: expect.any(Date),
          stakworkProjectId: 12345,
          status: "IN_PROGRESS",
        },
      });
    });

    test("should update task status to FAILED on API error", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);
      
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: "test-task-id" },
        data: {
          workflowStatus: "FAILED",
        },
      });
    });

    test("should handle Stakwork API response without project_id", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: "test-task-id" },
        data: {
          workflowStatus: "IN_PROGRESS",
          workflowStartedAt: expect.any(Date),
          status: "IN_PROGRESS",
        },
      });
    });
  });

  describe("Workflow Mode Selection", () => {
    test.each([
      ["live", 123],
      ["unit", 789],
      ["integration", 789],
      ["test", 456],
      ["default", 456],
    ])("should use correct workflow ID for mode %s", async (mode, expectedWorkflowId) => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      // We can't test the internal function directly, but we can test createTaskWithStakworkWorkflow
      // which calls createChatMessageAndTriggerStakwork with mode parameter
      await createTaskWithStakworkWorkflow({
        title: "Test Task",
        description: "Test description",
        workspaceId: "test-workspace-id",
        priority: "MEDIUM",
        userId: "test-user-id",
        initialMessage: "Test message",
        mode: mode,
      });

      const fetchCall = mockFetch.mock.calls.find(call => 
        call[0].toString().includes('stakwork')
      );
      
      expect(fetchCall).toBeTruthy();
      const payload = JSON.parse(fetchCall![1]!.body as string);
      expect(payload.workflow_id).toBe(expectedWorkflowId);
    });
  });

  describe("Swarm Configuration", () => {
    test("should transform swarmUrl correctly for API and repo2graph", async () => {
      const mockTask = createMockTask({
        workspace: {
          id: "test-workspace-id",
          slug: "test-workspace",
          swarm: {
            swarmUrl: "https://custom-swarm.com/api",
            swarmSecretAlias: "secret-123",
            poolName: "custom-pool",
            id: "swarm-123",
          },
        },
      });
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.swarmUrl).toBe("https://custom-swarm.com:8444/api");
      expect(vars.repo2graph_url).toBe("https://custom-swarm.com:3355");
      expect(vars.poolName).toBe("swarm-123");
      expect(vars.swarmSecretAlias).toBe("secret-123");
    });

    test("should handle missing swarm configuration", async () => {
      const mockTask = createMockTask({
        workspace: {
          id: "test-workspace-id",
          slug: "test-workspace",
          swarm: null,
        },
      });
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.swarmUrl).toBe("");
      expect(vars.repo2graph_url).toBe("");
      expect(vars.poolName).toBeNull();
      expect(vars.swarmSecretAlias).toBeNull();
    });
  });

  describe("Error Handling", () => {
    test("should handle fetch network error", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);
      
      mockFetch.mockRejectedValue(new Error("Network error"));

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      // Should update task to FAILED status
      expect(mockDb.task.update).toHaveBeenCalledWith({
        where: { id: "test-task-id" },
        data: {
          workflowStatus: "FAILED",
        },
      });
    });

    test("should throw error when Stakwork configuration is missing", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      // Temporarily clear Stakwork config
      vi.mocked(mockConfig).STAKWORK_API_KEY = "";

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      // Should not call fetch when config is missing
      expect(mockFetch).not.toHaveBeenCalled();
      
      // Restore config
      vi.mocked(mockConfig).STAKWORK_API_KEY = "test-stakwork-key";
    });

    test("should handle task not found error", async () => {
      mockDb.task.findFirst = vi.fn().mockResolvedValue(null);

      await expect(
        sendMessageToStakwork({
          taskId: "non-existent-task",
          message: "Test message",
          userId: "test-user-id",
        })
      ).rejects.toThrow("Task not found");
    });
  });

  describe("Task Source Tracking", () => {
    test("should include taskSource in Stakwork payload", async () => {
      const mockTask = createMockTask({ sourceType: "JANITOR" });
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      
      expect(payload.workflow_params.set_var.attributes.vars.taskSource).toBe("janitor");
    });
  });

  describe("Webhook URL Construction", () => {
    test("should construct correct webhook URLs", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);

      expect(payload.webhook_url).toBe("http://localhost:3000/api/stakwork/webhook?task_id=test-task-id");
      expect(payload.workflow_params.set_var.attributes.vars.webhookUrl).toBe("http://localhost:3000/api/chat/response");
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty attachments array", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: "Test message",
        userId: "test-user-id",
        attachments: [],
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      
      expect(payload.workflow_params.set_var.attributes.vars.attachments).toEqual([]);
    });

    test("should handle very long message content", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      const longMessage = "a".repeat(10000);

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: longMessage,
        userId: "test-user-id",
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: longMessage,
          }),
        })
      );
    });

    test("should handle special characters in message", async () => {
      const mockTask = createMockTask();
      mockDb.task.findFirst = vi.fn().mockResolvedValue(mockTask as any);

      const specialMessage = "Test with 🚀 emojis and special chars: àáâäåæçèéêë & <html> tags";

      await sendMessageToStakwork({
        taskId: "test-task-id",
        message: specialMessage,
        userId: "test-user-id",
      });

      expect(mockDb.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            message: specialMessage,
          }),
        })
      );
    });
  });
});