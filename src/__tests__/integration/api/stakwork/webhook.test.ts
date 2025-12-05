import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/stakwork/webhook/route";
import { WorkflowStatus, TaskStatus, StakworkRunType } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createPostRequest,
  createSignedWebhookRequest,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";

/**
 * Integration Tests for POST /api/stakwork/webhook
 * 
 * Tests HMAC-SHA256 signature verification for webhook authentication.
 * All valid requests must include x-stakwork-signature header with proper HMAC.
 */

// Mock external services only - use real database and utilities
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
  },
}));

const { pusherServer } = await import("@/lib/pusher");
const mockedPusherServer = vi.mocked(pusherServer);

describe("Stakwork Webhook API - POST /api/stakwork/webhook", () => {
  const webhookUrl = "http://localhost:3000/api/stakwork/webhook";
  const TEST_WEBHOOK_SECRET = "test-webhook-secret-key-for-integration-tests";

  // Set up environment variable before all tests
  beforeEach(() => {
    vi.stubEnv("STAKWORK_WEBHOOK_SECRET", TEST_WEBHOOK_SECRET);
    vi.clearAllMocks();
  });

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

  async function createTestRun(workflowStatus: WorkflowStatus = WorkflowStatus.PENDING) {
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

      const run = await tx.stakworkRun.create({
        data: {
          workspaceId: workspace.id,
          status: workflowStatus,
          projectId: 12345,
          webhookUrl: "https://example.com/webhook",
          type: StakworkRunType.TASK_GENERATION,
        },
      });

      return { user, workspace, run };
    });
  }

  describe("Security - HMAC Signature Verification", () => {
    test("should reject webhook without signature header", async () => {
      const { task } = await createTestTask();

      const request = createPostRequest(webhookUrl, {
        task_id: task.id,
        project_status: "completed",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("Missing signature");
    });

    test("should reject webhook with invalid signature", async () => {
      const { task } = await createTestTask();

      // Create request with wrong secret
      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
          project_status: "completed",
        },
        "wrong-secret-key"
      );

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("Invalid signature");
    });

    test("should accept webhook with valid signature", async () => {
      const { task } = await createTestTask();

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("should return 500 when webhook secret is not configured", async () => {
      vi.unstubAllEnvs();
      const { task } = await createTestTask();

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("Server configuration error");
    });
  });

  describe("Payload Validation", () => {
    test("should return 401 when both task_id and run_id are missing (no auth)", async () => {
      const request = createPostRequest(webhookUrl, {
        project_status: "completed",
      });

      const response = await POST(request);

      // Should fail auth before checking payload
      expect(response.status).toBe(401);
    });

    test("should return 400 when both task_id and run_id are missing (with valid auth)", async () => {
      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing task_id or run_id");
    });

    test("should return 400 when project_status is missing", async () => {
      const { task } = await createTestTask();

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing project_status");
    });

    test("should return 400 for empty string status", async () => {
      const { task } = await createTestTask();

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
          project_status: "",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing project_status");
    });

    test("should return 400 for invalid/unknown status", async () => {
      const { task } = await createTestTask();

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
          project_status: "unknown_invalid_status",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid or unsupported project_status");
    });

    test("should handle invalid JSON payload gracefully", async () => {
      const request = new Request(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-stakwork-signature": "dummy-sig",
        },
        body: "invalid json {",
      });

      const response = await POST(request);

      // Auth will fail first, or JSON parsing will fail
      expect([400, 401]).toContain(response.status);
    });
  });

  describe("Task Status Updates", () => {
    test("should update task workflow status with valid signature", async () => {
      const { task } = await createTestTask();

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.taskId).toBe(task.id);
      expect(data.workflowStatus).toBe(WorkflowStatus.COMPLETED);

      // Verify database update
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    });

    test("should return 404 when task is not found", async () => {
      const nonExistentTaskId = "cltasknotexistxxxxxxxxxx";

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: nonExistentTaskId,
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });

    test("should map various Stakwork statuses correctly", async () => {
      const statusMappings = [
        { input: "in_progress", expected: WorkflowStatus.IN_PROGRESS },
        { input: "running", expected: WorkflowStatus.IN_PROGRESS },
        { input: "completed", expected: WorkflowStatus.COMPLETED },
        { input: "success", expected: WorkflowStatus.COMPLETED },
        { input: "failed", expected: WorkflowStatus.FAILED },
        { input: "error", expected: WorkflowStatus.FAILED },
        { input: "halted", expected: WorkflowStatus.HALTED },
        { input: "paused", expected: WorkflowStatus.HALTED },
      ];

      for (const { input, expected } of statusMappings) {
        const { task } = await createTestTask();

        const request = createSignedWebhookRequest(
          webhookUrl,
          {
            task_id: task.id,
            project_status: input,
          },
          TEST_WEBHOOK_SECRET
        );

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.workflowStatus).toBe(expected);

        const updatedTask = await db.task.findUnique({
          where: { id: task.id },
        });

        expect(updatedTask?.workflowStatus).toBe(expected);
      }
    });

    test("should preserve task user status when updating workflow status", async () => {
      const { task } = await createTestTask();

      await db.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS },
      });

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

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
        const request = createSignedWebhookRequest(
          webhookUrl,
          {
            task_id: task.id,
            project_status: status,
          },
          TEST_WEBHOOK_SECRET
        );

        const response = await POST(request);
        expect(response.status).toBe(200);
      }

      const finalTask = await db.task.findUnique({
        where: { id: task.id },
      });

      expect(finalTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    });

    test("should handle concurrent status updates correctly", async () => {
      const { task } = await createTestTask(WorkflowStatus.PENDING);

      const requests = [
        createSignedWebhookRequest(
          webhookUrl,
          {
            task_id: task.id,
            project_status: "in_progress",
          },
          TEST_WEBHOOK_SECRET
        ),
        createSignedWebhookRequest(
          webhookUrl,
          {
            task_id: task.id,
            project_status: "completed",
          },
          TEST_WEBHOOK_SECRET
        ),
      ];

      const responses = await Promise.all(requests.map((req) => POST(req)));

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

  describe("StakworkRun Status Updates", () => {
    test("should update run status with valid signature", async () => {
      const { run } = await createTestRun();

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          run_id: run.id,
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.runId).toBe(run.id);
      expect(data.status).toBe(WorkflowStatus.COMPLETED);

      // Verify database update
      const updatedRun = await db.stakworkRun.findUnique({
        where: { id: run.id },
      });
      expect(updatedRun?.status).toBe(WorkflowStatus.COMPLETED);
    });

    test("should return 404 for non-existent run", async () => {
      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          run_id: "non-existent-run-id",
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Run not found");
    });
  });

  describe("Pusher Broadcasting", () => {
    test("should broadcast task status update to workspace channel", async () => {
      const { task, workspace } = await createTestTask();

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      await POST(request);

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${workspace.slug}`,
        "workflow-status-update",
        expect.objectContaining({
          taskId: task.id,
          workflowStatus: WorkflowStatus.COMPLETED,
        })
      );
    });

    test("should broadcast run status update to workspace channel", async () => {
      const { run, workspace } = await createTestRun();

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          run_id: run.id,
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      await POST(request);

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${workspace.slug}`,
        "stakwork-run-update",
        expect.objectContaining({
          runId: run.id,
          status: WorkflowStatus.COMPLETED,
        })
      );
    });

    test("should fail when Pusher broadcast fails", async () => {
      mockedPusherServer.trigger.mockRejectedValueOnce(
        new Error("Pusher connection failed")
      );

      const { task } = await createTestTask();

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);
      const data = await response.json();

      // Pusher failure should cause 500 error
      expect(response.status).toBe(500);
      expect(data.error).toBe("Internal server error");

      // Database update should have succeeded before Pusher failed
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    });
  });

  describe("Error Handling", () => {
    test("should handle database errors gracefully", async () => {
      const { task } = await createTestTask();

      // Delete task to cause database error
      await db.task.delete({
        where: { id: task.id },
      });

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });

    test("should return 500 for unexpected errors", async () => {
      // Mock database to throw unexpected error
      vi.spyOn(db.task, "findUnique").mockRejectedValueOnce(
        new Error("Database connection failed")
      );

      const { task } = await createTestTask();

      const request = createSignedWebhookRequest(
        webhookUrl,
        {
          task_id: task.id,
          project_status: "completed",
        },
        TEST_WEBHOOK_SECRET
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Internal server error");
    });
  });
});
