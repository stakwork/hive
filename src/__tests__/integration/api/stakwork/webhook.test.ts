import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/stakwork/webhook/route";
import { WorkflowStatus, TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createTestWorkspaceWithWebhook,
  computeStakworkSignature,
  createStakworkWebhookRequest,
  createStakworkWebhookRequestWithoutSignature,
  createStakworkWebhookRequestWithInvalidSignature,
} from "@/__tests__/support/fixtures/stakwork-webhook";

/**
 * Integration Tests for POST /api/stakwork/webhook
 * 
 * Tests signature verification using HMAC-SHA256 to secure webhook endpoints.
 * Similar to GitHub and Stakgraph webhook security patterns.
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Security - Signature Verification", () => {
    test("should reject webhook without signature header", async () => {
      const { task } = await createTestWorkspaceWithWebhook();

      const request = createStakworkWebhookRequestWithoutSignature(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Missing signature");
    });

    test("should reject webhook with invalid signature", async () => {
      const { task } = await createTestWorkspaceWithWebhook();

      const request = createStakworkWebhookRequestWithInvalidSignature(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid signature");
    });

    test("should accept webhook with valid signature", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();
      
      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should return 401 when webhook secret is not configured", async () => {
      // Create workspace without webhook secret
      const { task } = await createTestWorkspaceWithWebhook();
      
      // Remove the webhook secret from workspace
      await db.workspace.update({
        where: { id: task.workspaceId },
        data: { stakworkWebhookSecret: null },
      });

      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature("any_secret", body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Webhook secret not configured");
    });

    test("should handle signature with sha256= prefix", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();
      
      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      
      // Request helper already adds sha256= prefix
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should handle signature without sha256= prefix", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();
      
      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const rawSignature = computeStakworkSignature(webhookSecret, body);
      
      // Create request without prefix
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": rawSignature, // No prefix
        },
        body,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe("Payload Validation", () => {
    test("should return 401 when task_id is missing (signature check happens first)", async () => {
      const { webhookSecret } = await createTestWorkspaceWithWebhook();
      
      const payload = {
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);
      const data = await response.json();

      // Signature check fails because task_id missing means we can't look up workspace
      expect(response.status).toBe(400);
      expect(data.error).toBe("task_id is required");
    });

    test("should return 400 when project_status is missing", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();
      
      const payload = {
        task_id: task.id,
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("project_status is required");
    });

    test("should accept task_id from query parameter as fallback", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();
      
      const payload = {
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(
        `${webhookUrl}?task_id=${task.id}`,
        payload,
        signature
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.taskId).toBe(task.id);
    });

    test("should prioritize task_id from body over query parameter", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();
      const { task: anotherTask } = await createTestWorkspaceWithWebhook({
        webhookSecret, // Use same secret
      });

      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(
        `${webhookUrl}?task_id=${anotherTask.id}`,
        payload,
        signature
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
          "x-stakwork-signature": "sha256=invalid",
        },
        body: "invalid json {",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid JSON payload");
    });
  });

  describe("Task Lookup", () => {
    test("should return 404 when task is not found", async () => {
      const { webhookSecret } = await createTestWorkspaceWithWebhook();
      const nonExistentTaskId = "cltasknotexistxxxxxxxxxx";

      const payload = {
        task_id: nonExistentTaskId,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });

    test("should return 404 when task is soft-deleted", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();

      await db.task.update({
        where: { id: task.id },
        data: { deleted: true },
      });

      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });
  });

  describe("Status Mapping and Updates", () => {
    test("should update task to IN_PROGRESS and set workflowStartedAt", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook({
        workflowStatus: WorkflowStatus.PENDING,
      });

      const payload = {
        task_id: task.id,
        project_status: "in_progress",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

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
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook({
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });

      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

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
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook({
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });

      const payload = {
        task_id: task.id,
        project_status: "failed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.FAILED);
      expect(updatedTask?.workflowCompletedAt).not.toBeNull();
    });

    test("should update task to HALTED and set workflowCompletedAt", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook({
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });

      const payload = {
        task_id: task.id,
        project_status: "halted",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.HALTED);
      expect(updatedTask?.workflowCompletedAt).not.toBeNull();
    });

    test("should handle unknown status gracefully (return 200 without update)", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook({
        workflowStatus: WorkflowStatus.PENDING,
      });
      const originalUpdatedAt = task.updatedAt;

      const payload = {
        task_id: task.id,
        project_status: "unknown_status_xyz",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

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
        const { task, webhookSecret } = await createTestWorkspaceWithWebhook();

        const payload = {
          task_id: task.id,
          project_status: input,
        };
        const body = JSON.stringify(payload);
        const signature = computeStakworkSignature(webhookSecret, body);
        const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

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
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();

      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

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
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook({
        workflowStatus: WorkflowStatus.PENDING,
      });

      const payload = {
        task_id: task.id,
        project_status: "in_progress",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

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

      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();

      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

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
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();

      const payload = {
        task_id: task.id,
        project_status: "unknown_status",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      await POST(request);

      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    test("should return 404 when task is deleted after signature verification", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();

      await db.task.delete({
        where: { id: task.id },
      });

      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });

    test("should handle concurrent status updates correctly", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook({
        workflowStatus: WorkflowStatus.PENDING,
      });

      const requests = [
        {
          task_id: task.id,
          project_status: "in_progress",
        },
        {
          task_id: task.id,
          project_status: "completed",
        },
      ].map((payload) => {
        const body = JSON.stringify(payload);
        const signature = computeStakworkSignature(webhookSecret, body);
        return createStakworkWebhookRequest(webhookUrl, payload, signature);
      });

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
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook({
        workflowStatus: WorkflowStatus.PENDING,
      });

      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

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
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();

      const payload = {
        task_id: task.id,
        project_status: "unknown",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

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
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();

      const payload = {
        task_id: task.id,
        project_status: "",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("project_status is required");
    });

    test("should handle case-sensitive status strings", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();

      const payload = {
        task_id: task.id,
        project_status: "COMPLETED",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should preserve task user status when updating workflow status", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook();

      await db.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS },
      });

      const payload = {
        task_id: task.id,
        project_status: "completed",
      };
      const body = JSON.stringify(payload);
      const signature = computeStakworkSignature(webhookSecret, body);
      const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

      await POST(request);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.status).toBe(TaskStatus.IN_PROGRESS);
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    });

    test("should handle multiple status transitions in sequence", async () => {
      const { task, webhookSecret } = await createTestWorkspaceWithWebhook({
        workflowStatus: WorkflowStatus.PENDING,
      });

      const statuses = ["in_progress", "completed"];

      for (const status of statuses) {
        const payload = {
          task_id: task.id,
          project_status: status,
        };
        const body = JSON.stringify(payload);
        const signature = computeStakworkSignature(webhookSecret, body);
        const request = createStakworkWebhookRequest(webhookUrl, payload, signature);

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
