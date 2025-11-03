import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/stakwork/webhook/route";
import { WorkflowStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { computeHmacSha256Hex } from "@/lib/encryption";
import {
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
} from "@/__tests__/support/helpers";

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
  },
}));

describe("Stakwork Webhook HMAC Authentication", () => {
  const WEBHOOK_SECRET = "test-webhook-secret-key";
  let originalSecret: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalSecret = process.env.STAKWORK_WEBHOOK_SECRET;
    process.env.STAKWORK_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env.STAKWORK_WEBHOOK_SECRET = originalSecret;
  });

  async function createTestTask() {
    const user = await db.user.create({
      data: {
        id: generateUniqueId("user"),
        email: `user-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });

    const workspace = await db.workspace.create({
      data: {
        name: `Test Workspace ${generateUniqueId()}`,
        slug: generateUniqueSlug("test-workspace"),
        ownerId: user.id,
      },
    });

    const task = await db.task.create({
      data: {
        title: "Test Task",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        workflowStatus: WorkflowStatus.PENDING,
      },
    });

    return { task, workspace, user };
  }

  function createWebhookRequest(
    payload: Record<string, unknown>,
    signature?: string,
  ) {
    const rawBody = JSON.stringify(payload);
    const headers = new Headers({
      "content-type": "application/json",
    });

    if (signature) {
      headers.set("x-signature", signature);
    }

    const request = new Request("http://localhost/api/stakwork/webhook", {
      method: "POST",
      headers,
      body: rawBody,
    });

    return request as any;
  }

  describe("HMAC Signature Verification", () => {
    test("should accept valid HMAC signature and update task status", async () => {
      const { task } = await createTestTask();

      const payload = {
        project_status: "completed",
        task_id: task.id,
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeHmacSha256Hex(WEBHOOK_SECRET, rawBody);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data.workflowStatus).toBe(WorkflowStatus.COMPLETED);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
      expect(updatedTask?.workflowCompletedAt).toBeTruthy();
    });

    test("should accept signature with sha256= prefix", async () => {
      const { task } = await createTestTask();

      const payload = {
        project_status: "in_progress",
        task_id: task.id,
      };

      const rawBody = JSON.stringify(payload);
      const signature = `sha256=${computeHmacSha256Hex(WEBHOOK_SECRET, rawBody)}`;

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(updatedTask?.workflowStartedAt).toBeTruthy();
    });

    test("should reject request with missing signature header", async () => {
      const { task } = await createTestTask();

      const payload = {
        project_status: "completed",
        task_id: task.id,
      };

      const request = createWebhookRequest(payload);
      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(401);
      expect(responseData.error).toBe("Unauthorized");

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.PENDING);
    });

    test("should reject request with invalid signature", async () => {
      const { task } = await createTestTask();

      const payload = {
        project_status: "completed",
        task_id: task.id,
      };

      const request = createWebhookRequest(payload, "invalid-signature-12345");
      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(401);
      expect(responseData.error).toBe("Unauthorized");

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.PENDING);
    });

    test("should reject request with tampered payload", async () => {
      const { task } = await createTestTask();

      const originalPayload = {
        project_status: "in_progress",
        task_id: task.id,
      };

      const rawBody = JSON.stringify(originalPayload);
      const signature = computeHmacSha256Hex(WEBHOOK_SECRET, rawBody);

      const tamperedPayload = {
        project_status: "completed",
        task_id: task.id,
      };

      const request = createWebhookRequest(tamperedPayload, signature);
      const response = await POST(request);

      expect(response.status).toBe(401);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.PENDING);
    });

    test("should return 500 when STAKWORK_WEBHOOK_SECRET is not configured", async () => {
      delete process.env.STAKWORK_WEBHOOK_SECRET;

      const { task } = await createTestTask();

      const payload = {
        project_status: "completed",
        task_id: task.id,
      };

      const request = createWebhookRequest(payload, "any-signature");
      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.error).toBe("Server configuration error");
    });

    test("should reject request with invalid JSON payload", async () => {
      const invalidJson = "{ invalid json }";
      const signature = computeHmacSha256Hex(WEBHOOK_SECRET, invalidJson);

      const headers = new Headers({
        "content-type": "application/json",
        "x-signature": signature,
      });

      const request = new Request("http://localhost/api/stakwork/webhook", {
        method: "POST",
        headers,
        body: invalidJson,
      });

      const response = await POST(request as any);
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData.error).toBe("Invalid JSON");
    });
  });

  describe("Existing Webhook Workflow Integration", () => {
    test("should handle task_id from query parameter with valid signature", async () => {
      const { task } = await createTestTask();

      const payload = {
        project_status: "completed",
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeHmacSha256Hex(WEBHOOK_SECRET, rawBody);

      const headers = new Headers({
        "content-type": "application/json",
        "x-signature": signature,
      });

      const request = new Request(
        `http://localhost/api/stakwork/webhook?task_id=${task.id}`,
        {
          method: "POST",
          headers,
          body: rawBody,
        }
      );

      const response = await POST(request as any);

      expect(response.status).toBe(200);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
    });

    test("should return 400 when task_id is missing", async () => {
      const payload = {
        project_status: "completed",
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeHmacSha256Hex(WEBHOOK_SECRET, rawBody);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(400);
      expect(responseData.error).toBe("task_id is required");
    });

    test("should return 404 when task does not exist", async () => {
      const payload = {
        project_status: "completed",
        task_id: "non-existent-task-id",
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeHmacSha256Hex(WEBHOOK_SECRET, rawBody);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(404);
      expect(responseData.error).toBe("Task not found");
    });

    test("should handle unknown status gracefully", async () => {
      const { task } = await createTestTask();

      const payload = {
        project_status: "unknown_status",
        task_id: task.id,
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeHmacSha256Hex(WEBHOOK_SECRET, rawBody);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.data.action).toBe("ignored");

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.PENDING);
    });

    test("should update workflowStartedAt for IN_PROGRESS status", async () => {
      const { task } = await createTestTask();

      const payload = {
        project_status: "running",
        task_id: task.id,
      };

      const rawBody = JSON.stringify(payload);
      const signature = computeHmacSha256Hex(WEBHOOK_SECRET, rawBody);

      const request = createWebhookRequest(payload, signature);
      const response = await POST(request);

      expect(response.status).toBe(200);

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(updatedTask?.workflowStartedAt).toBeTruthy();
      expect(updatedTask?.workflowCompletedAt).toBeNull();
    });

    test("should update workflowCompletedAt for terminal states", async () => {
      const { task } = await createTestTask();

      const testCases = [
        { status: "failed", expected: WorkflowStatus.FAILED },
        { status: "halted", expected: WorkflowStatus.HALTED },
        { status: "completed", expected: WorkflowStatus.COMPLETED },
      ];

      for (const testCase of testCases) {
        await db.task.update({
          where: { id: task.id },
          data: {
            workflowStatus: WorkflowStatus.PENDING,
            workflowCompletedAt: null,
          },
        });

        const payload = {
          project_status: testCase.status,
          task_id: task.id,
        };

        const rawBody = JSON.stringify(payload);
        const signature = computeHmacSha256Hex(WEBHOOK_SECRET, rawBody);

        const request = createWebhookRequest(payload, signature);
        const response = await POST(request);

        expect(response.status).toBe(200);

        const updatedTask = await db.task.findUnique({
          where: { id: task.id },
        });
        expect(updatedTask?.workflowStatus).toBe(testCase.expected);
        expect(updatedTask?.workflowCompletedAt).toBeTruthy();
      }
    });
  });
});
