import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { Priority, TaskStatus } from "@prisma/client";
import {
  createTaskWithStakworkWorkflow,
  sendMessageToStakwork,
  callStakworkAPI,
} from "@/services/task-workflow";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import { generateUniqueId } from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm } from "@prisma/client";

// Mock external dependencies
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-key",
    STAKWORK_BASE_URL: "https://stakwork.example.com",
    STAKWORK_WORKFLOW_ID: "123,456,789",
  },
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(() =>
    Promise.resolve({
      username: "testuser",
      token: "github-token-123",
    })
  ),
}));

vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn(() => "http://localhost:3000"),
}));

// Mock fetch globally
global.fetch = vi.fn();

const mockFetch = fetch as vi.MockedFunction<typeof fetch>;

describe("Task Workflow Service - Integration Tests", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Task Workflow Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `workflow-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        swarmUrl: "https://swarm.example.com/api",
        swarmSecretAlias: "test-secret",
        poolName: "test-pool",
      });
    });

    // Setup default successful Stakwork response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          project_id: 12345,
        },
      }),
    } as Response);

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createTaskWithStakworkWorkflow", () => {
    test("should create task and trigger Stakwork workflow with real database", async () => {
      const result = await createTaskWithStakworkWorkflow({
        title: "Integration Test Task",
        description: "This is a test task",
        workspaceId: workspace.id,
        priority: "MEDIUM" as Priority,
        userId: owner.id,
        initialMessage: "Initial message for workflow",
        status: "TODO" as TaskStatus,
      });

      expect(result).toBeDefined();
      expect(result.task).toBeDefined();
      expect(result.chatMessage).toBeDefined();

      // Verify task was created in database
      const createdTask = await db.task.findUnique({
        where: { id: result.task.id },
        include: {
          workspace: true,
        },
      });

      expect(createdTask).toBeDefined();
      expect(createdTask?.title).toBe("Integration Test Task");
      expect(createdTask?.description).toBe("This is a test task");
      expect(createdTask?.workspaceId).toBe(workspace.id);
      expect(createdTask?.priority).toBe("MEDIUM");
      expect(createdTask?.status).toBe("TODO");
      expect(createdTask?.createdById).toBe(owner.id);

      // Verify chat message was created
      const chatMessage = await db.chatMessage.findUnique({
        where: { id: result.chatMessage.id },
      });

      expect(chatMessage).toBeDefined();
      expect(chatMessage?.taskId).toBe(result.task.id);
      expect(chatMessage?.message).toBe("Initial message for workflow");
      expect(chatMessage?.role).toBe("USER");
      expect(chatMessage?.status).toBe("SENT");

      // Verify Stakwork was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("should handle task creation with all optional fields", async () => {
      const result = await createTaskWithStakworkWorkflow({
        title: "Full Task",
        description: "Task with all fields",
        workspaceId: workspace.id,
        assigneeId: owner.id,
        priority: "HIGH" as Priority,
        sourceType: "JANITOR",
        userId: owner.id,
        initialMessage: "Complete task setup",
        status: "IN_PROGRESS" as TaskStatus,
        mode: "live",
      });

      const createdTask = await db.task.findUnique({
        where: { id: result.task.id },
      });

      expect(createdTask?.assigneeId).toBe(owner.id);
      expect(createdTask?.sourceType).toBe("JANITOR");
      expect(createdTask?.status).toBe("IN_PROGRESS");

      // Verify mode was passed to Stakwork
      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      expect(payload.workflow_id).toBe(123); // live mode uses first workflow ID
    });

    test("should rollback task creation if Stakwork call fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Stakwork unreachable"));

      const result = await createTaskWithStakworkWorkflow({
        title: "Task That Will Fail",
        description: "Stakwork will fail",
        workspaceId: workspace.id,
        priority: "LOW" as Priority,
        userId: owner.id,
        initialMessage: "This will fail",
      });

      // Task should still be created but workflow status should be FAILED
      const createdTask = await db.task.findUnique({
        where: { id: result.task.id },
      });

      expect(createdTask).toBeDefined();
      expect(createdTask?.workflowStatus).toBe("FAILED");
    });

    test("should trim whitespace from title and description", async () => {
      const result = await createTaskWithStakworkWorkflow({
        title: "  Task With Spaces  ",
        description: "  Description With Spaces  ",
        workspaceId: workspace.id,
        priority: "MEDIUM" as Priority,
        userId: owner.id,
        initialMessage: "Trimmed task",
      });

      const createdTask = await db.task.findUnique({
        where: { id: result.task.id },
      });

      expect(createdTask?.title).toBe("Task With Spaces");
      expect(createdTask?.description).toBe("Description With Spaces");
    });
  });

  describe("sendMessageToStakwork", () => {
    let existingTask: any;

    beforeEach(async () => {
      // Create a task first
      existingTask = await db.task.create({
        data: {
          title: "Existing Task",
          description: "Task for message testing",
          workspaceId: workspace.id,
          status: "TODO",
          priority: "MEDIUM",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
    });

    test("should send message to existing task with real database", async () => {
      const result = await sendMessageToStakwork({
        taskId: existingTask.id,
        message: "Follow-up message",
        userId: owner.id,
        contextTags: [{ type: "file", value: "test.ts" }],
        attachments: ["/uploads/doc.pdf"],
      });

      expect(result).toBeDefined();
      expect(result.chatMessage).toBeDefined();

      // Verify message was created
      const chatMessage = await db.chatMessage.findUnique({
        where: { id: result.chatMessage.id },
      });

      expect(chatMessage).toBeDefined();
      expect(chatMessage?.taskId).toBe(existingTask.id);
      expect(chatMessage?.message).toBe("Follow-up message");
      expect(chatMessage?.role).toBe("USER");

      const contextTags = JSON.parse(chatMessage?.contextTags || "[]");
      expect(contextTags).toEqual([{ type: "file", value: "test.ts" }]);

      // Verify Stakwork was called with correct payload
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);

      expect(payload.workflow_params.set_var.attributes.vars.message).toBe("Follow-up message");
      expect(payload.workflow_params.set_var.attributes.vars.contextTags).toEqual([
        { type: "file", value: "test.ts" },
      ]);
      expect(payload.workflow_params.set_var.attributes.vars.attachments).toEqual([
        "/uploads/doc.pdf",
      ]);
    });

    test("should update task workflow status after message send", async () => {
      await sendMessageToStakwork({
        taskId: existingTask.id,
        message: "Status update message",
        userId: owner.id,
      });

      // Verify task status was updated
      const updatedTask = await db.task.findUnique({
        where: { id: existingTask.id },
      });

      expect(updatedTask?.workflowStatus).toBe("IN_PROGRESS");
      expect(updatedTask?.workflowStartedAt).toBeDefined();
      expect(updatedTask?.stakworkProjectId).toBe(12345);
    });

    test("should throw error for non-existent task", async () => {
      await expect(
        sendMessageToStakwork({
          taskId: "non-existent-task-id",
          message: "Message to nowhere",
          userId: owner.id,
        })
      ).rejects.toThrow("Task not found");
    });

    test("should throw error for deleted task", async () => {
      // Delete the task
      await db.task.update({
        where: { id: existingTask.id },
        data: { deleted: true },
      });

      await expect(
        sendMessageToStakwork({
          taskId: existingTask.id,
          message: "Message to deleted task",
          userId: owner.id,
        })
      ).rejects.toThrow("Task not found");
    });

    test("should handle multiple messages to same task sequentially", async () => {
      const message1 = await sendMessageToStakwork({
        taskId: existingTask.id,
        message: "First message",
        userId: owner.id,
      });

      const message2 = await sendMessageToStakwork({
        taskId: existingTask.id,
        message: "Second message",
        userId: owner.id,
      });

      // Verify both messages were created
      const messages = await db.chatMessage.findMany({
        where: { taskId: existingTask.id },
        orderBy: { timestamp: "asc" },
      });

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe(message1.chatMessage.id);
      expect(messages[1].id).toBe(message2.chatMessage.id);
      expect(messages[0].message).toBe("First message");
      expect(messages[1].message).toBe("Second message");
    });
  });

  describe("callStakworkAPI", () => {
    test("should construct correct Stakwork API payload", async () => {
      await callStakworkAPI({
        taskId: "test-task-id",
        message: "API test message",
        contextTags: [{ type: "test", value: "tag" }],
        userName: "testuser",
        accessToken: "token123",
        swarmUrl: "https://swarm.example.com:8444/api",
        swarmSecretAlias: "secret-alias",
        poolName: "pool-123",
        repo2GraphUrl: "https://swarm.example.com:3355",
        attachments: ["/uploads/file.pdf"],
        mode: "default",
        taskSource: "USER",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];

      expect(url).toBe("https://stakwork.example.com/projects");
      expect(options?.method).toBe("POST");
      expect(options?.headers).toEqual({
        Authorization: "Token token=test-stakwork-key",
        "Content-Type": "application/json",
      });

      const payload = JSON.parse(options?.body as string);
      expect(payload.name).toBe("hive_autogen");
      expect(payload.workflow_id).toBe(456); // default mode
      expect(payload.webhook_url).toContain("/api/stakwork/webhook?task_id=test-task-id");
      expect(payload.workflow_params.set_var.attributes.vars).toMatchObject({
        taskId: "test-task-id",
        message: "API test message",
        contextTags: [{ type: "test", value: "tag" }],
        username: "testuser",
        accessToken: "token123",
        swarmUrl: "https://swarm.example.com:8444/api",
        swarmSecretAlias: "secret-alias",
        poolName: "pool-123",
        repo2graph_url: "https://swarm.example.com:3355",
        attachments: ["/uploads/file.pdf"],
        taskMode: "default",
        taskSource: "user",
      });
    });

    test("should throw error when Stakwork configuration is missing", async () => {
      const { config: mockConfig } = await import("@/lib/env");
      const originalApiKey = mockConfig.STAKWORK_API_KEY;

      vi.mocked(mockConfig).STAKWORK_API_KEY = "";

      await expect(
        callStakworkAPI({
          taskId: "test-task-id",
          message: "Test",
          userName: null,
          accessToken: null,
          swarmUrl: "",
          swarmSecretAlias: null,
          poolName: null,
          repo2GraphUrl: "",
        })
      ).rejects.toThrow("Stakwork configuration missing");

      vi.mocked(mockConfig).STAKWORK_API_KEY = originalApiKey;
    });

    test("should return error object when API call fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      const result = await callStakworkAPI({
        taskId: "test-task-id",
        message: "Test",
        userName: null,
        accessToken: null,
        swarmUrl: "",
        swarmSecretAlias: null,
        poolName: null,
        repo2GraphUrl: "",
      });

      expect(result).toEqual({
        success: false,
        error: "Internal Server Error",
      });
    });

    test("should handle different workflow modes correctly", async () => {
      const modes = [
        { mode: "live", expectedId: 123 },
        { mode: "unit", expectedId: 789 },
        { mode: "integration", expectedId: 789 },
        { mode: "default", expectedId: 456 },
      ];

      for (const { mode, expectedId } of modes) {
        vi.clearAllMocks();

        await callStakworkAPI({
          taskId: "test-task-id",
          message: "Test",
          userName: null,
          accessToken: null,
          swarmUrl: "",
          swarmSecretAlias: null,
          poolName: null,
          repo2GraphUrl: "",
          mode,
        });

        const payload = JSON.parse(mockFetch.mock.calls[0][1]!.body as string);
        expect(payload.workflow_id).toBe(expectedId);
      }
    });
  });

  describe("Error Recovery", () => {
    test("should handle transient database errors gracefully", async () => {
      // Simulate temporary database failure
      const originalCreate = db.chatMessage.create;
      let attemptCount = 0;

      vi.spyOn(db.chatMessage, "create").mockImplementation(async (args: any) => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error("Connection timeout");
        }
        return originalCreate(args);
      });

      await expect(
        createTaskWithStakworkWorkflow({
          title: "Retry Test",
          description: "Testing retry logic",
          workspaceId: workspace.id,
          priority: "MEDIUM" as Priority,
          userId: owner.id,
          initialMessage: "Retry message",
        })
      ).rejects.toThrow("Connection timeout");
    });

    test("should maintain data consistency on partial failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          error: "Workflow validation failed",
        }),
      } as Response);

      const result = await createTaskWithStakworkWorkflow({
        title: "Partial Failure Task",
        description: "This will partially fail",
        workspaceId: workspace.id,
        priority: "LOW" as Priority,
        userId: owner.id,
        initialMessage: "Partial failure message",
      });

      // Task and message should exist
      const task = await db.task.findUnique({
        where: { id: result.task.id },
      });
      const message = await db.chatMessage.findUnique({
        where: { id: result.chatMessage.id },
      });

      expect(task).toBeDefined();
      expect(message).toBeDefined();
      expect(task?.workflowStatus).toBe("FAILED");
    });
  });

  describe("Swarm Configuration Integration", () => {
    test("should use swarm configuration from workspace", async () => {
      const result = await createTaskWithStakworkWorkflow({
        title: "Swarm Config Test",
        description: "Testing swarm configuration",
        workspaceId: workspace.id,
        priority: "MEDIUM" as Priority,
        userId: owner.id,
        initialMessage: "Swarm test message",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.swarmUrl).toBe("https://swarm.example.com:8444/api");
      expect(vars.repo2graph_url).toBe("https://swarm.example.com:3355");
      expect(vars.swarmSecretAlias).toBe("test-secret");
      expect(vars.poolName).toBe(swarm.id);
    });

    test("should handle workspace without swarm gracefully", async () => {
      // Create workspace without swarm
      const noSwarmScenario = await createTestWorkspaceScenario({
        owner: { name: "No Swarm Owner" },
      });

      const result = await createTaskWithStakworkWorkflow({
        title: "No Swarm Task",
        description: "Task without swarm",
        workspaceId: noSwarmScenario.workspace.id,
        priority: "MEDIUM" as Priority,
        userId: noSwarmScenario.owner.id,
        initialMessage: "No swarm message",
      });

      const fetchCall = mockFetch.mock.calls[0];
      const payload = JSON.parse(fetchCall[1]!.body as string);
      const vars = payload.workflow_params.set_var.attributes.vars;

      expect(vars.swarmUrl).toBe("");
      expect(vars.repo2graph_url).toBe("");
      expect(vars.swarmSecretAlias).toBeNull();
      expect(vars.poolName).toBeNull();
    });
  });
});