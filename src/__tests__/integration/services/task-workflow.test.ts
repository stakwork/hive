import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { config } from "@/lib/env";
import {
  createTaskWithStakworkWorkflow,
  sendMessageToStakwork,
} from "@/services/task-workflow";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getBaseUrl } from "@/lib/utils";
import type { User, Task, Workspace, ChatMessage } from "@prisma/client";

// Mock external dependencies
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_BASE_URL: "https://api.stakwork.test",
    STAKWORK_WORKFLOW_ID: "123,456,789",
  },
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

// Mock fetch for Stakwork API calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("Task Workflow - Integration Tests", () => {
  let testUser: User;
  let testWorkspace: Workspace;
  let testTask: Task;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create test user
    testUser = await db.user.create({
      data: {
        id: `user-${Date.now()}-${Math.random()}`,
        email: `user-${Date.now()}@example.com`,
        name: "Test User",
      },
    });

    // Create test workspace with swarm
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: `test-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        ownerId: testUser.id,
      },
    });

    // Create swarm for the workspace
    await db.swarm.create({
      data: {
        name: "test-swarm",
        workspaceId: testWorkspace.id,
        swarmUrl: "https://test-swarm.sphinx.chat/api",
        swarmSecretAlias: "{{SWARM_TEST_API_KEY}}",
        status: "ACTIVE",
      },
    });

    // Create test task
    testTask = await db.task.create({
      data: {
        title: "Test Task",
        description: "Test task description",
        workspaceId: testWorkspace.id,
        status: "TODO",
        priority: "MEDIUM",
        createdById: testUser.id,
        updatedById: testUser.id,
      },
    });

    // Setup GitHub credentials mock
    (getGithubUsernameAndPAT as any).mockResolvedValue({
      username: "testuser",
      pat: "test-pat-token",
      appAccessToken: "test-app-token",
    });
  });

  afterEach(async () => {
    // Clean up test data
    await db.chatMessage.deleteMany({
      where: { taskId: testTask.id },
    });
    await db.task.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.swarm.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.workspace.deleteMany({
      where: { id: testWorkspace.id },
    });
    await db.user.deleteMany({
      where: { id: testUser.id },
    });
  });

  describe("createChatMessageAndTriggerStakwork", () => {
    test("should create chat message successfully in database", async () => {
      // Mock successful Stakwork API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          project_id: 12345,
          status: "created",
        }),
      });

      const result = await sendMessageToStakwork({
        taskId: testTask.id,
        message: "Test message for workflow",
        userId: testUser.id,
        contextTags: [{ type: "FEATURE_BRIEF", content: "test feature" }],
      });

      // Verify chat message was created in database
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: {
          task: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });

      expect(chatMessage).toBeDefined();
      expect(chatMessage?.message).toBe("Test message for workflow");
      expect(chatMessage?.role).toBe("USER");
      expect(chatMessage?.status).toBe("SENT");
      expect(chatMessage?.taskId).toBe(testTask.id);
      expect(chatMessage?.contextTags).toBe(JSON.stringify([{ type: "FEATURE_BRIEF", content: "test feature" }]));
      expect(result.chatMessage).toBeDefined();
    });

    test("should invoke Stakwork API with correct payload structure", async () => {
      // Mock successful Stakwork API response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          project_id: 12345,
        }),
      });

      await sendMessageToStakwork({
        taskId: testTask.id,
        message: "API payload test message",
        userId: testUser.id,
        contextTags: [],
      });

      // Verify Stakwork API was called with correct structure
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("https://api.stakwork.test/projects");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual({
        "Authorization": "Token token=test-api-key",
        "Content-Type": "application/json",
      });

      const payload = JSON.parse(options.body);
      expect(payload).toMatchObject({
        name: "hive_autogen",
        workflow_id: expect.any(Number),
        webhook_url: expect.stringContaining(`/api/stakwork/webhook?task_id=${testTask.id}`),
        workflow_params: {
          set_var: {
            attributes: {
              vars: expect.objectContaining({
                taskId: testTask.id,
                message: "API payload test message",
                contextTags: [],
                webhookUrl: expect.stringContaining("/api/chat/response"),
                username: "testuser",
                accessToken: "test-app-token",
                swarmUrl: "https://test-swarm.sphinx.chat:8444/api",
                swarmSecretAlias: "{{SWARM_TEST_API_KEY}}",
                repo2graph_url: "https://test-swarm.sphinx.chat:3355",
                attachments: [],
                taskMode: "default",
              }),
            },
          },
        },
      });
    });

    test("should update task status to IN_PROGRESS on successful API call", async () => {
      // Mock successful Stakwork API response with project ID
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          project_id: 98765,
          status: "workflow_started",
        }),
      });

      await sendMessageToStakwork({
        taskId: testTask.id,
        message: "Success test message",
        userId: testUser.id,
      });

      // Verify task was updated with correct status and project ID
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });

      expect(updatedTask?.workflowStatus).toBe("IN_PROGRESS");
      expect(updatedTask?.stakworkProjectId).toBe(98765);
      expect(updatedTask?.workflowStartedAt).toBeDefined();
      expect(updatedTask?.workflowStartedAt).toBeInstanceOf(Date);
    });

    test("should handle Stakwork API failure and set task status to FAILED", async () => {
      // Mock failed Stakwork API response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
        json: async () => ({ error: "Workflow execution failed" }),
      });

      await sendMessageToStakwork({
        taskId: testTask.id,
        message: "Failure test message",
        userId: testUser.id,
      });

      // Verify task status was set to FAILED
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });

      expect(updatedTask?.workflowStatus).toBe("FAILED");
      expect(updatedTask?.stakworkProjectId).toBeNull();
    });

    test("should handle network errors and set task status to FAILED", async () => {
      // Mock network error
      mockFetch.mockRejectedValueOnce(new Error("Network connection failed"));

      await sendMessageToStakwork({
        taskId: testTask.id,
        message: "Network error test message",
        userId: testUser.id,
      });

      // Verify task status was set to FAILED
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });

      expect(updatedTask?.workflowStatus).toBe("FAILED");
    });

    test("should handle missing GitHub credentials gracefully", async () => {
      // Mock no GitHub credentials available
      (getGithubUsernameAndPAT as any).mockResolvedValue(null);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          project_id: 11111,
        }),
      });

      await sendMessageToStakwork({
        taskId: testTask.id,
        message: "No credentials test",
        userId: testUser.id,
      });

      // Verify API was called with null credentials
      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.username).toBeNull();
      expect(payload.workflow_params.set_var.attributes.vars.accessToken).toBeNull();

      // Verify task was still updated successfully
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask?.workflowStatus).toBe("IN_PROGRESS");
    });

    test("should throw error for non-existent task", async () => {
      const nonExistentTaskId = "non-existent-task-id";

      await expect(
        sendMessageToStakwork({
          taskId: nonExistentTaskId,
          message: "Test message",
          userId: testUser.id,
        })
      ).rejects.toThrow("Task not found");
    });

    test("should throw error for non-existent user", async () => {
      const nonExistentUserId = "non-existent-user-id";

      await expect(
        sendMessageToStakwork({
          taskId: testTask.id,
          message: "Test message",
          userId: nonExistentUserId,
        })
      ).rejects.toThrow("User not found");
    });

    test("should handle different workflow modes correctly", async () => {
      const modes = ["default", "live", "unit", "integration"];
      const expectedWorkflowIds = [456, 123, 789, 789]; // Based on config mock

      for (let i = 0; i < modes.length; i++) {
        const mode = modes[i];
        const expectedWorkflowId = expectedWorkflowIds[i];

        mockFetch.mockClear();
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, project_id: 1000 + i }),
        });

        // Create a new task for each mode test
        const modeTask = await db.task.create({
          data: {
            title: `Test Task ${mode}`,
            workspaceId: testWorkspace.id,
            status: "TODO",
            priority: "MEDIUM",
            createdById: testUser.id,
            updatedById: testUser.id,
          },
        });

        await sendMessageToStakwork({
          taskId: modeTask.id,
          message: `Test message for ${mode} mode`,
          userId: testUser.id,
        });

        const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(payload.workflow_id).toBe(expectedWorkflowId);
        expect(payload.workflow_params.set_var.attributes.vars.taskMode).toBe("default");

        // Clean up
        await db.chatMessage.deleteMany({ where: { taskId: modeTask.id } });
        await db.task.delete({ where: { id: modeTask.id } });
      }
    });

    test("should handle attachments in workflow payload", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, project_id: 33333 }),
      });

      const attachments = ["path/to/file1.txt", "path/to/file2.jpg"];

      await sendMessageToStakwork({
        taskId: testTask.id,
        message: "Message with attachments",
        userId: testUser.id,
        attachments,
      });

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.workflow_params.set_var.attributes.vars.attachments).toEqual(attachments);
    });
  });

  describe("createTaskWithStakworkWorkflow", () => {
    test("should create task and trigger workflow successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, project_id: 77777 }),
      });

      const result = await createTaskWithStakworkWorkflow({
        title: "Workflow Integration Task",
        description: "Task created via workflow",
        workspaceId: testWorkspace.id,
        priority: "HIGH",
        userId: testUser.id,
        initialMessage: "Initial workflow message",
        status: "IN_PROGRESS",
      });

      // Verify task was created
      expect(result.task).toBeDefined();
      expect(result.task.title).toBe("Workflow Integration Task");
      expect(result.task.description).toBe("Task created via workflow");
      expect(result.task.priority).toBe("HIGH");
      expect(result.task.status).toBe("IN_PROGRESS");
      expect(result.task.workspaceId).toBe(testWorkspace.id);

      // Verify chat message was created
      expect(result.chatMessage).toBeDefined();
      expect(result.chatMessage.message).toBe("Initial workflow message");
      expect(result.chatMessage.role).toBe("USER");

      // Verify task was updated with workflow status
      const taskInDb = await db.task.findUnique({
        where: { id: result.task.id },
      });
      expect(taskInDb?.workflowStatus).toBe("IN_PROGRESS");
      expect(taskInDb?.stakworkProjectId).toBe(77777);
    });

    test("should handle workflow failure in task creation flow", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Service Unavailable",
      });

      const result = await createTaskWithStakworkWorkflow({
        title: "Failed Workflow Task",
        description: "This workflow should fail",
        workspaceId: testWorkspace.id,
        priority: "MEDIUM",
        userId: testUser.id,
        initialMessage: "This should trigger failure",
      });

      // Task should still be created
      expect(result.task).toBeDefined();
      expect(result.task.title).toBe("Failed Workflow Task");

      // But workflow should fail
      const taskInDb = await db.task.findUnique({
        where: { id: result.task.id },
      });
      expect(taskInDb?.workflowStatus).toBe("FAILED");
      expect(taskInDb?.stakworkProjectId).toBeNull();
    });
  });

  describe("Stakwork API Configuration", () => {
    test("should handle missing Stakwork configuration", async () => {
      // Mock missing config
      const originalConfig = { ...config };
      (config as any).STAKWORK_API_KEY = undefined;

      await expect(
        sendMessageToStakwork({
          taskId: testTask.id,
          message: "Test without config",
          userId: testUser.id,
        })
      ).rejects.toThrow("Stakwork configuration missing");

      // Restore config
      Object.assign(config, originalConfig);
    });

    test("should construct webhook URLs correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, project_id: 55555 }),
      });

      (getBaseUrl as any).mockReturnValue("https://production.example.com");

      await sendMessageToStakwork({
        taskId: testTask.id,
        message: "URL construction test",
        userId: testUser.id,
      });

      const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(payload.webhook_url).toBe(
        `https://production.example.com/api/stakwork/webhook?task_id=${testTask.id}`
      );
      expect(payload.workflow_params.set_var.attributes.vars.webhookUrl).toBe(
        "https://production.example.com/api/chat/response"
      );
    });
  });

  describe("Database State Verification", () => {
    test("should maintain database consistency on successful workflow", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          project_id: 99999,
          workflow_url: "https://workflow.stakwork.test/99999",
        }),
      });

      const initialChatMessageCount = await db.chatMessage.count({
        where: { taskId: testTask.id },
      });

      await sendMessageToStakwork({
        taskId: testTask.id,
        message: "Database consistency test",
        userId: testUser.id,
      });

      // Verify exactly one chat message was created
      const finalChatMessageCount = await db.chatMessage.count({
        where: { taskId: testTask.id },
      });
      expect(finalChatMessageCount).toBe(initialChatMessageCount + 1);

      // Verify task status is consistent
      const task = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(task?.workflowStatus).toBe("IN_PROGRESS");
      expect(task?.stakworkProjectId).toBe(99999);
      expect(task?.workflowStartedAt).toBeDefined();
      expect(task?.workflowCompletedAt).toBeNull(); // Should not be completed yet
    });

    test("should maintain database consistency on failed workflow", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Database connection failed"));

      const initialChatMessageCount = await db.chatMessage.count({
        where: { taskId: testTask.id },
      });

      await sendMessageToStakwork({
        taskId: testTask.id,
        message: "Database failure consistency test",
        userId: testUser.id,
      });

      // Verify chat message was still created
      const finalChatMessageCount = await db.chatMessage.count({
        where: { taskId: testTask.id },
      });
      expect(finalChatMessageCount).toBe(initialChatMessageCount + 1);

      // Verify task failure status is set
      const task = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(task?.workflowStatus).toBe("FAILED");
      expect(task?.stakworkProjectId).toBeNull();
      expect(task?.workflowStartedAt).toBeNull();
    });

    test("should handle concurrent workflow calls gracefully", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, project_id: 11111 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true, project_id: 22222 }),
        });

      // Simulate concurrent calls
      const promises = [
        sendMessageToStakwork({
          taskId: testTask.id,
          message: "Concurrent message 1",
          userId: testUser.id,
        }),
        sendMessageToStakwork({
          taskId: testTask.id,
          message: "Concurrent message 2", 
          userId: testUser.id,
        }),
      ];

      const results = await Promise.all(promises);

      // Verify both messages were created
      const chatMessages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        orderBy: { createdAt: "asc" },
      });

      expect(chatMessages).toHaveLength(2);
      expect(chatMessages[0].message).toBe("Concurrent message 1");
      expect(chatMessages[1].message).toBe("Concurrent message 2");

      // Verify both results are valid
      expect(results[0].chatMessage).toBeDefined();
      expect(results[1].chatMessage).toBeDefined();
    });
  });
});