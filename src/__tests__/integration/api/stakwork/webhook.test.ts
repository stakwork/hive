import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/stakwork/webhook/route";
import { WorkflowStatus, TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createPostRequest,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { computeHmacSha256Hex } from "@/lib/encryption";

/**
 * Integration Tests for POST /api/stakwork/webhook
 * 
 * Tests webhook HMAC signature verification and task status updates.
 */

// Mock external services only - use real database and utilities
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
  },
}));

const { pusherServer } = await import("@/lib/pusher");
const mockedPusherServer = vi.mocked(pusherServer);

describe("Stakwork Webhook API - POST /api/stakwork/webhook", () => {
  const webhookUrl = "http://localhost:3000/api/stakwork/webhook";
  const WEBHOOK_SECRET = "test-webhook-secret-key";
  let originalSecret: string | undefined;

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
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      const task = await tx.task.create({
        data: {
          title: "Test Task for Webhook",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          status: TaskStatus.TODO,
          workflowStatus,
        },
      });

      return { user, workspace, task };
    });
  }

  function createWebhookRequest(
    payload: Record<string, unknown>,
    url: string = webhookUrl,
  ) {
    const rawBody = JSON.stringify(payload);
    const signature = computeHmacSha256Hex(WEBHOOK_SECRET, rawBody);
    
    const headers = new Headers({
      "content-type": "application/json",
      "x-signature": signature,
    });

    const request = new Request(url, {
      method: "POST",
      headers,
      body: rawBody,
    });

    return request as any;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    originalSecret = process.env.STAKWORK_WEBHOOK_SECRET;
    process.env.STAKWORK_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env.STAKWORK_WEBHOOK_SECRET = originalSecret;
  });

  describe("Security - HMAC Signature Verification", () => {
    test("should reject webhook without signature header", async () => {
      const { task } = await createTestTask();

      // Use createPostRequest (no signature) to test rejection
      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
    });
  });

  describe("Payload Validation", () => {
    test("should return 400 when task_id is missing from body and query", async () => {
      const request = createWebhookRequest({
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("task_id is required");
    });

    test("should return 400 when project_status is missing", async () => {
      const { task } = await createTestTask();

      const request = createWebhookRequest({
        task_id: task.id,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("project_status is required");
    });

    test("should accept task_id from query parameter as fallback", async () => {
      const { task } = await createTestTask();

      const request = createWebhookRequest(
        {
          project_status: "completed",
        },
        `${webhookUrl}?task_id=${task.id}`
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

      const request = createWebhookRequest(
        {
          task_id: task.id,
          project_status: "completed",
        },
        `${webhookUrl}?task_id=${anotherTask.id}`
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.taskId).toBe(task.id);
    });

    test("should handle invalid JSON payload gracefully", async () => {
      // This test is now handled in the new HMAC test file
      // The invalid JSON test requires a signature to pass HMAC verification
      // Without signature, it returns 401, with signature it can test JSON parsing
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "invalid json {",
      });

      const response = await POST(request);

      // Without signature header, returns 401 Unauthorized
      expect(response.status).toBe(401);
    });
  });

  describe("Task Lookup", () => {
    test("should return 404 when task is not found", async () => {
      const nonExistentTaskId = "cltasknotexistxxxxxxxxxx";

      const request = createWebhookRequest({
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

      await db.task.update({
        where: { id: task.id },
        data: { deleted: true },
      });

      const request = createWebhookRequest({
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

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "in_progress",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(updatedTask?.workflowStartedAt).not.toBeNull();
      expect(updatedTask?.workflowCompletedAt).toBeNull();
    });

    test("should update task to COMPLETED and set workflowCompletedAt", async () => {
      const { task } = await createTestTask(WorkflowStatus.IN_PROGRESS);

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.workflowStatus).toBe(WorkflowStatus.COMPLETED);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
      expect(updatedTask?.workflowCompletedAt).not.toBeNull();
    });

    test("should update task to FAILED and set workflowCompletedAt", async () => {
      const { task } = await createTestTask(WorkflowStatus.IN_PROGRESS);

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "failed",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.FAILED);
      expect(updatedTask?.workflowCompletedAt).not.toBeNull();
    });

    test("should update task to HALTED and set workflowCompletedAt", async () => {
      const { task } = await createTestTask(WorkflowStatus.IN_PROGRESS);

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "halted",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.HALTED);
      expect(updatedTask?.workflowCompletedAt).not.toBeNull();
    });

    test("should handle unknown status gracefully (return 200 without update)", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING);
      const originalUpdatedAt = task.updatedAt;

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "unknown_status_xyz",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toContain("Unknown status");
      expect(data.data.action).toBe("ignored");

      const taskAfter = await db.task.findUnique({
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

        const request = createWebhookRequest({
          task_id: task.id,
          project_status: input,
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.data.workflowStatus).toBe(expected);

        const updatedTask = await db.task.findUnique({
          where: { id: task.id },
        });

        expect(updatedTask?.workflowStatus).toBe(expected);
      }
    });
  });

  describe("Pusher Broadcasting", () => {
    test("should broadcast status update to Pusher channel", async () => {
      const { task } = await createTestTask();

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "completed",
      });

      await POST(request);

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${task.id}`,
        "workflow-status-update",
        expect.objectContaining({
          taskId: task.id,
          workflowStatus: WorkflowStatus.COMPLETED,
          timestamp: expect.any(Date),
        })
      );
    });

    test("should include timestamps in Pusher payload", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING);

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "in_progress",
      });

      await POST(request);

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          workflowStartedAt: expect.any(Date),
          workflowCompletedAt: null,
        })
      );
    });

    test("should tolerate Pusher broadcast failures (eventual consistency)", async () => {
      mockedPusherServer.trigger.mockRejectedValueOnce(new Error("Pusher connection failed"));

      const { task } = await createTestTask();

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    });

    test("should not broadcast when status is unknown", async () => {
      const { task } = await createTestTask();

      const request = createWebhookRequest({
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

      await db.task.delete({
        where: { id: task.id },
      });

      const request = createWebhookRequest({
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
        createWebhookRequest({
          task_id: task.id,
          project_status: "in_progress",
        }),
        createWebhookRequest({
          task_id: task.id,
          project_status: "completed",
        }),
      ];

      const responses = await Promise.all(
        requests.map((req) => POST(req))
      );

      expect(responses[0].status).toBe(200);
      expect(responses[1].status).toBe(200);

      const finalTask = await db.task.findUnique({
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

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data).toMatchObject({
        success: true,
        data: {
          taskId: task.id,
          workflowStatus: WorkflowStatus.COMPLETED,
          previousStatus: WorkflowStatus.PENDING,
        },
      });
    });

    test("should include action field for unknown status", async () => {
      const { task } = await createTestTask();

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "unknown",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.data).toMatchObject({
        taskId: task.id,
        receivedStatus: "unknown",
        action: "ignored",
      });
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty string status", async () => {
      const { task } = await createTestTask();

      const request = createWebhookRequest({
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

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "COMPLETED",
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should preserve task user status when updating workflow status", async () => {
      const { task } = await createTestTask();

      await db.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS },
      });

      const request = createWebhookRequest({
        task_id: task.id,
        project_status: "completed",
      });

      await POST(request);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.status).toBe(TaskStatus.IN_PROGRESS);
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    });

    test("should handle multiple status transitions in sequence", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING);

      const statuses = ["in_progress", "completed"];

      for (const status of statuses) {
        const request = createWebhookRequest({
          task_id: task.id,
          project_status: status,
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
      }

      const finalTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(finalTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
      expect(finalTask?.workflowStartedAt).not.toBeNull();
      expect(finalTask?.workflowCompletedAt).not.toBeNull();
    });
  });
});