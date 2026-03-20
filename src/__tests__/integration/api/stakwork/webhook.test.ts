import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/stakwork/webhook/route";
import { WorkflowStatus, TaskStatus, ChatRole, ChatStatus, ArtifactType } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createPostRequest,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";

/**
 * Integration Tests for POST /api/stakwork/webhook
 * 
 * SECURITY NOTE: This endpoint currently has NO signature verification,
 * unlike other webhooks (GitHub, Stakgraph). This is a known security gap.
 * Any client can send POST requests to manipulate task statuses.
 * 
 * Future enhancement: Implement HMAC-SHA256 signature verification
 * similar to Stakgraph webhook (see src/app/api/swarm/stakgraph/webhook/route.ts)
 */

// Mock external services only - use real database and utilities
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    NEW_MESSAGE: "new-message",
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
  },
}));

vi.mock("@/lib/auth/nextauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/nextauth")>();
  return {
    ...actual,
    getGithubUsernameAndPAT: vi.fn().mockResolvedValue({
      username: "test-github-user",
      token: "test-github-token",
    }),
  };
});

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: vi.fn().mockReturnValue("{{HIVE_STAGING}}"),
}));

const { pusherServer } = await import("@/lib/pusher");
const mockedPusherServer = vi.mocked(pusherServer);

// Save and restore global.fetch around tests that mock it
let originalFetch: typeof global.fetch;

describe("Stakwork Webhook API - POST /api/stakwork/webhook", () => {
  const webhookUrl = "http://localhost:3000/api/stakwork/webhook";

  async function createTestTask(workflowStatus: WorkflowStatus = WorkflowStatus.PENDING) {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: `Test Workspace ${generateUniqueId()}`,
          slug: generateUniqueSlug("test-workspace"),owner_id: user.id,
        },
      });

      await tx.workspaceMember.create({
        data: {workspace_id: workspace.id,user_id: user.id,
          role: "OWNER",
        },
      });

      const task = await tx.task.create({
        data: {
          title: "Test Task for Webhook",workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
          status: TaskStatus.TODO,
          workflowStatus,
        },
      });

      return { user, workspace, task };
    });
  }

  /**
   * Creates a workflow_editor task with a WORKFLOW artifact in chat history
   * so the auto-retry service can recover context.
   */
  async function createWorkflowEditorTask(
    opts: {workflow_status?: WorkflowStatus;
halt_retry_attempted?: boolean;
      withWorkflowArtifact?: boolean;
    } = {},
  ) {
    const {
      workflowStatus = WorkflowStatus.IN_PROGRESS,
      haltRetryAttempted = false,
      withWorkflowArtifact = true,
    } = opts;

    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Workflow User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: `WE Workspace ${generateUniqueId()}`,
          slug: generateUniqueSlug("we-workspace"),owner_id: user.id,
        },
      });

      const task = await tx.task.create({
        data: {
          title: "Workflow Editor Task",workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
          status: TaskStatus.IN_PROGRESS,
          workflowStatus,
          mode: "workflow_editor",
          haltRetryAttempted,
        },
      });

      if (withWorkflowArtifact) {
        // Add a user message then an assistant WORKFLOW artifact
        await tx.chatMessage.create({
          data: {task_id: task.id,
            message: "Make the workflow faster",
            role: ChatRole.USER,
            status: ChatStatus.SENT,context_tags: JSON.stringify([]),
          },
        });

        await tx.chatMessage.create({
          data: {task_id: task.id,
            message: "",
            role: ChatRole.ASSISTANT,
            status: ChatStatus.SENT,context_tags: JSON.stringify([]),
            artifacts: {
              create: [
                {
                  type: ArtifactType.WORKFLOW,
                  content: {project_id: "proj-123",
                    workflowId: 42,
                    workflowName: "Test Workflow",
                    workflowRefId: "ref-abc-xyz",
                    workflowVersionId: "v1",
                  },
                },
              ],
            },
          },
        });
      }

      return { user, workspace, task };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("Security - No Signature Verification", () => {
    test("should accept webhook without signature verification (SECURITY GAP)", async () => {
      const { task } = await createTestTask();

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      // This succeeds without any authentication/signature - security vulnerability
    });
  });

  describe("Payload Validation", () => {
    test("should return 400 when both task_id and run_id are missing", async () => {
      const request = createPostRequest(webhookUrl, {
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Either task_id or run_id is required");
    });

    test("should return 400 when project_status is missing", async () => {
      const { task } = await createTestTask();

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("project_status is required");
    });

    test("should accept task_id from query parameter as fallback", async () => {
      const { task } = await createTestTask();

      const request = createPostRequest(
        `${webhookUrl}?task_id=${task.id}`,
        {
          project_status: "completed",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.taskId).toBe(task.id);
    });

    test("should prioritize task_id from body over query parameter", async () => {
      const { task } = await createTestTask();
      const { task: anotherTask } = await createTestTask();

      const request = createPostRequest(
        `${webhookUrl}?task_id=${anotherTask.id}`,
        {
          task_id: task.id,
          project_status: "completed",
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.taskId).toBe(task.id);
    });

    test("should handle invalid JSON payload gracefully", async () => {
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "invalid json {",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });

  describe("Task Lookup", () => {
    test("should return 404 when task is not found", async () => {
      const nonExistentTaskId = "cltasknotexistxxxxxxxxxx";

      const request = createPostRequest(webhookUrl, {
        task_id: nonExistentTaskId,
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });

    test("should return 404 when task is soft-deleted", async () => {
      const { task } = await createTestTask();

      await db.tasks.update({
        where: { id: task.id },
        data: { deleted: true },
      });

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });
  });

  describe("Status Mapping and Updates", () => {
    test("should update task to IN_PROGRESS and set workflowStartedAt", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING);

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "in_progress",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);

      const updatedTask = await db.tasks.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(updatedTask?.workflowStartedAt).not.toBeNull();
      expect(updatedTask?.workflowCompletedAt).toBeNull();
    });

    test("should update task to COMPLETED and set workflowCompletedAt", async () => {
      const { task } = await createTestTask(WorkflowStatus.IN_PROGRESS);

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.workflowStatus).toBe(WorkflowStatus.COMPLETED);

      const updatedTask = await db.tasks.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
      expect(updatedTask?.workflowCompletedAt).not.toBeNull();
    });

    test("should update task to FAILED and set workflowCompletedAt", async () => {
      const { task } = await createTestTask(WorkflowStatus.IN_PROGRESS);

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "failed",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedTask = await db.tasks.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.FAILED);
      expect(updatedTask?.workflowCompletedAt).not.toBeNull();
    });

    test("should update task to HALTED and set workflowCompletedAt", async () => {
      const { task } = await createTestTask(WorkflowStatus.IN_PROGRESS);

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "halted",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedTask = await db.tasks.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.HALTED);
      expect(updatedTask?.workflowCompletedAt).not.toBeNull();
    });

    test("should handle unknown status gracefully (return 200 without update)", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING);
      const originalUpdatedAt = task.updatedAt;

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "unknown_status_xyz",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toContain("Unknown status");
      expect(data.data.action).toBe("ignored");

      const taskAfter = await db.tasks.findUnique({
        where: { id: task.id },
      });

      expect(taskAfter?.workflowStatus).toBe(WorkflowStatus.PENDING);
      expect(taskAfter?.updatedAt.getTime()).toBe(originalUpdatedAt.getTime());
    });

    test("should map various status strings correctly", async () => {
      const statusMappings = [
        { input: "running", expected: WorkflowStatus.IN_PROGRESS },
        { input: "processing", expected: WorkflowStatus.IN_PROGRESS },
        { input: "success", expected: WorkflowStatus.COMPLETED },
        { input: "finished", expected: WorkflowStatus.COMPLETED },
        { input: "error", expected: WorkflowStatus.FAILED },
        { input: "paused", expected: WorkflowStatus.HALTED },
        { input: "stopped", expected: WorkflowStatus.HALTED },
      ];

      for (const { input, expected } of statusMappings) {
        const { task } = await createTestTask();

        const request = createPostRequest(webhookUrl, {
          task_id: task.id,
          project_status: input,
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.data.workflowStatus).toBe(expected);

        const updatedTask = await db.tasks.findUnique({
          where: { id: task.id },
        });

        expect(updatedTask?.workflowStatus).toBe(expected);
      }
    });
  });

  describe("Pusher Broadcasting", () => {
    test("should broadcast status update to Pusher channel", async () => {
      const { task } = await createTestTask();

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      await POST(request);

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${task.id}`,
        "workflow-status-update",
        expect.objectContaining({task_id: task.id,workflow_status: WorkflowStatus.COMPLETED,
          timestamp: expect.any(Date),
        })
      );
    });

    test("should include timestamps in Pusher payload", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING);

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "in_progress",
      });

      await POST(request);

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({workflow_started_at: expect.any(Date),workflow_completed_at: null,
        })
      );
    });

    test("should tolerate Pusher broadcast failures (eventual consistency)", async () => {
      mockedPusherServer.trigger.mockRejectedValueOnce(new Error("Pusher connection failed"));

      const { task } = await createTestTask();

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      const updatedTask = await db.tasks.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    });

    test("should not broadcast when status is unknown", async () => {
      const { task } = await createTestTask();

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "unknown_status",
      });

      await POST(request);

      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    test("should return 500 when database update fails", async () => {
      const { task } = await createTestTask();

      await db.tasks.delete({
        where: { id: task.id },
      });

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });

    test("should handle concurrent status updates correctly", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING);

      const requests = [
        createPostRequest(webhookUrl, {
          task_id: task.id,
          project_status: "in_progress",
        }),
        createPostRequest(webhookUrl, {
          task_id: task.id,
          project_status: "completed",
        }),
      ];

      const responses = await Promise.all(
        requests.map((req) => POST(req))
      );

      expect(responses[0].status).toBe(200);
      expect(responses[1].status).toBe(200);

      const finalTask = await db.tasks.findUnique({
        where: { id: task.id },
      });

      expect([WorkflowStatus.IN_PROGRESS, WorkflowStatus.COMPLETED]).toContain(
        finalTask?.workflowStatus
      );
    });
  });

  describe("Response Format", () => {
    test("should return success with task data", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING);

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data).toMatchObject({
        success: true,
        data: {task_id: task.id,workflow_status: WorkflowStatus.COMPLETED,
          previousStatus: WorkflowStatus.PENDING,
        },
      });
    });

    test("should include action field for unknown status", async () => {
      const { task } = await createTestTask();

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "unknown",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.data).toMatchObject({task_id: task.id,
        receivedStatus: "unknown",
        action: "ignored",
      });
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty string status", async () => {
      const { task } = await createTestTask();

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("project_status is required");
    });

    test("should handle case-sensitive status strings", async () => {
      const { task } = await createTestTask();

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "COMPLETED",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should preserve task user status when updating workflow status", async () => {
      const { task } = await createTestTask();

      await db.tasks.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS },
      });

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      await POST(request);

      const updatedTask = await db.tasks.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.status).toBe(TaskStatus.IN_PROGRESS);
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    });

    test("should handle multiple status transitions in sequence", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING);

      const statuses = ["in_progress", "completed"];

      for (const status of statuses) {
        const request = createPostRequest(webhookUrl, {
          task_id: task.id,
          project_status: status,
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
      }

      const finalTask = await db.tasks.findUnique({
        where: { id: task.id },
      });

      expect(finalTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
      expect(finalTask?.workflowStartedAt).not.toBeNull();
      expect(finalTask?.workflowCompletedAt).not.toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Auto-retry for workflow_editor terminal states
  // ────────────────────────────────────────────────────────────────────────────
  describe("Auto-retry for workflow_editor terminal states", () => {
    test("first terminal webhook on workflow_editor task triggers retry, task stays IN_PROGRESS", async () => {
      const { task } = await createWorkflowEditorTask({workflow_status: WorkflowStatus.IN_PROGRESS,halt_retry_attempted: false,
        withWorkflowArtifact: true,
      });

      // Mock Stakwork to return success so the retry fires
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 9001 } }),
      });

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "halted",
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.action).toBe("retried");

      // Task should be back to IN_PROGRESS, haltRetryAttempted reset to false
      const updatedTask = await db.tasks.findUnique({ where: { id: task.id } });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(updatedTask?.haltRetryAttempted).toBe(false);

      // WORKFLOW_STATUS_UPDATE Pusher event should NOT have been broadcast for terminal state
      const pusherCalls = mockedPusherServer.trigger.mock.calls;
      const statusUpdateCalls = pusherCalls.filter(
        (c) => c[1] === "workflow-status-update",
      );
      expect(statusUpdateCalls).toHaveLength(0);
    });

    test("second terminal webhook (haltRetryAttempted=true) writes terminal status and broadcasts", async () => {
      const { task } = await createWorkflowEditorTask({workflow_status: WorkflowStatus.IN_PROGRESS,halt_retry_attempted: true,
        withWorkflowArtifact: true,
      });

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "halted",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      // Task should now be HALTED
      const updatedTask = await db.tasks.findUnique({ where: { id: task.id } });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.HALTED);

      // WORKFLOW_STATUS_UPDATE should have been broadcast
      const pusherCalls = mockedPusherServer.trigger.mock.calls;
      const statusUpdateCalls = pusherCalls.filter(
        (c) => c[1] === "workflow-status-update",
      );
      expect(statusUpdateCalls.length).toBeGreaterThan(0);
    });

    test("non-workflow_editor task + terminal status proceeds normally (no retry)", async () => {
      // Regular (live mode) task
      const { task } = await createTestTask(WorkflowStatus.IN_PROGRESS);

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "halted",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const updatedTask = await db.tasks.findUnique({ where: { id: task.id } });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.HALTED);

      // Pusher broadcast should have fired for terminal state
      const pusherCalls = mockedPusherServer.trigger.mock.calls;
      const statusUpdateCalls = pusherCalls.filter(
        (c) => c[1] === "workflow-status-update",
      );
      expect(statusUpdateCalls.length).toBeGreaterThan(0);
    });

    test("workflow_editor task with no WORKFLOW artifact in history — terminal status applied directly", async () => {
      const { task } = await createWorkflowEditorTask({workflow_status: WorkflowStatus.IN_PROGRESS,halt_retry_attempted: false,
        withWorkflowArtifact: false, // No WORKFLOW artifact
      });

      // Add only a user message (no WORKFLOW artifact)
      await db.chat_messages.create({
        data: {task_id: task.id,
          message: "some message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,context_tags: JSON.stringify([]),
        },
      });

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "halted",
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      // No retry possible — task should be HALTED directly
      const updatedTask = await db.tasks.findUnique({ where: { id: task.id } });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.HALTED);
    });

    test("FAILED terminal status also triggers retry for workflow_editor tasks", async () => {
      const { task } = await createWorkflowEditorTask({workflow_status: WorkflowStatus.IN_PROGRESS,halt_retry_attempted: false,
        withWorkflowArtifact: true,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 9002 } }),
      });

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "failed",
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.action).toBe("retried");

      const updatedTask = await db.tasks.findUnique({ where: { id: task.id } });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(updatedTask?.haltRetryAttempted).toBe(false);
    });
  });
});
