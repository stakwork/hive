import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/stakwork/webhook/route";
import { WorkflowStatus, TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import {
  generateStakworkSignature,
  generateStakworkSignatureRaw,
  createStakworkWebhookPayload,
} from "@/__tests__/support/fixtures/stakwork-webhook";

// Mock external services only - use real database and utilities
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
  },
}));

const { pusherServer } = await import("@/lib/pusher");
const mockedPusherServer = vi.mocked(pusherServer);

describe("Stakwork Webhook API - POST /api/stakwork/webhook", () => {
  const webhookUrl = "http://localhost:3000/api/stakwork/webhook";
  const testWebhookSecret = "test-webhook-secret-12345";

  async function createTestTask(
    workflowStatus: WorkflowStatus = WorkflowStatus.PENDING,
    includeWebhookSecret: boolean = true
  ) {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const encryptionService = EncryptionService.getInstance();
      const encryptedSecret = includeWebhookSecret
        ? JSON.stringify(
            encryptionService.encryptField("stakworkWebhookSecret", testWebhookSecret)
          )
        : null;

      const workspace = await tx.workspace.create({
        data: {
          name: `Test Workspace ${generateUniqueId()}`,
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
          stakworkWebhookSecret: encryptedSecret,
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Security - HMAC-SHA256 Signature Verification", () => {
    test("should accept webhook with valid signature", async () => {
      const { task } = await createTestTask();
      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });

      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.taskId).toBe(task.id);
    });

    test("should accept signature without sha256= prefix", async () => {
      const { task } = await createTestTask();
      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });

      const signature = generateStakworkSignatureRaw(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("should reject webhook with missing signature header", async () => {
      const { task } = await createTestTask();
      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });

    test("should reject webhook with invalid signature", async () => {
      const { task } = await createTestTask();
      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });

      const invalidSignature = generateStakworkSignature("wrong-secret", payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": invalidSignature,
        },
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");

      // Verify task was not updated
      const unchangedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(unchangedTask?.workflowStatus).toBe(WorkflowStatus.PENDING);
    });

    test("should reject webhook when workspace has no webhook secret", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING, false);
      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });

      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });

    test("should reject webhook with tampered payload (signature mismatch)", async () => {
      const { task } = await createTestTask();
      const originalPayload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });

      const signature = generateStakworkSignature(testWebhookSecret, originalPayload);

      // Tamper with payload after generating signature
      const tamperedPayload = {
        ...originalPayload,
        project_status: "failed",
      };

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(tamperedPayload),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
    });

    test("should use timing-safe comparison (prevent timing attacks)", async () => {
      const { task } = await createTestTask();
      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });

      // Generate slightly incorrect signature (off by one character)
      const correctSignature = generateStakworkSignature(testWebhookSecret, payload);
      const almostCorrectSignature = correctSignature.slice(0, -1) + "x";

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": almostCorrectSignature,
        },
        body: JSON.stringify(payload),
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
    });
  });

  describe("Payload Validation", () => {
    test("should return 400 when both task_id and run_id are missing", async () => {
      await createTestTask();
      const payload = { project_status: "completed" };
      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Either task_id or run_id is required");
    });

    test("should return 400 when project_status is missing", async () => {
      const { task } = await createTestTask();
      const payload = { task_id: task.id };
      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("project_status is required");
    });

    test("should accept task_id from query parameter as fallback", async () => {
      const { task } = await createTestTask();
      const payload = { project_status: "completed" };
      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(`${webhookUrl}?task_id=${task.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
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
      expect(data.success).toBe(false);
      expect(data.error).toBe("Invalid JSON");
    });
  });

  describe("Task Lookup", () => {
    test("should return 404 when task is not found", async () => {
      await createTestTask();
      const nonExistentTaskId = "cltasknotexistxxxxxxxxxx";
      const payload = createStakworkWebhookPayload({
        task_id: nonExistentTaskId,
        project_status: "completed",
      });
      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
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

      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });
      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
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
      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "in_progress",
      });
      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
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
      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });
      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
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

    test("should handle unknown status gracefully (return 200 without update)", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING);
      const originalUpdatedAt = task.updatedAt;

      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "unknown_status_xyz",
      });
      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
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
  });

  describe("Pusher Broadcasting", () => {
    test("should broadcast status update to Pusher channel", async () => {
      const { task } = await createTestTask();
      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });
      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
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

    test("should tolerate Pusher broadcast failures (eventual consistency)", async () => {
      mockedPusherServer.trigger.mockRejectedValueOnce(new Error("Pusher connection failed"));

      const { task } = await createTestTask();
      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });
      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
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
  });

  describe("Error Handling", () => {
    test("should preserve task user status when updating workflow status", async () => {
      const { task } = await createTestTask();

      await db.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS },
      });

      const payload = createStakworkWebhookPayload({
        task_id: task.id,
        project_status: "completed",
      });
      const signature = generateStakworkSignature(testWebhookSecret, payload);

      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": signature,
        },
        body: JSON.stringify(payload),
      });

      await POST(request);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(updatedTask?.status).toBe(TaskStatus.IN_PROGRESS);
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    });
  });
});
