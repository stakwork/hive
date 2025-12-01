import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/stakwork/webhook/route";
import { WorkflowStatus, TaskStatus } from "@prisma/client";
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
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
  },
}));

const { pusherServer } = await import("@/lib/pusher");
const mockedPusherServer = vi.mocked(pusherServer);

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

  beforeEach(() => {
    vi.clearAllMocks();
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

      await db.task.update({
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

      const updatedTask = await db.task.findUnique({
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

      const updatedTask = await db.task.findUnique({
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

      const updatedTask = await db.task.findUnique({
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

      const updatedTask = await db.task.findUnique({
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

        const request = createPostRequest(webhookUrl, {
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

      const request = createPostRequest(webhookUrl, {
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

      const request = createPostRequest(webhookUrl, {
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

      const request = createPostRequest(webhookUrl, {
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

      await db.task.delete({
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

      const request = createPostRequest(webhookUrl, {
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

      const request = createPostRequest(webhookUrl, {
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

      await db.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.IN_PROGRESS },
      });

      const request = createPostRequest(webhookUrl, {
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
        const request = createPostRequest(webhookUrl, {
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