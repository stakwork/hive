import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/stakwork/webhook/route";
import { db } from "@/lib/db";
import { NextRequest } from "next/server";
import {
  createStakworkTestTask,
  createStakworkWebhookPayload,
  computeStakworkWebhookSignature,
  createStakworkWebhookRequest,
} from "@/__tests__/support/fixtures/stakwork-webhook";

// Mock pusher to avoid real-time broadcasting in tests
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
}));

describe("Stakwork Webhook API - Signature Validation", () => {
  let testWorkspace: any;
  let testTask: any;
  let webhookSecret: string;

  beforeEach(async () => {
    // Cleanup
    await db.task.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();

    // Setup test data using helper
    const result = await createStakworkTestTask();
    testTask = result.task;
    testWorkspace = result.workspace;
    webhookSecret = result.webhookSecret!;
  });

  afterEach(async () => {
    await db.task.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.user.deleteMany();
  });

  it("should reject request with missing signature header", async () => {
    const payload = createStakworkWebhookPayload(testTask.id, "completed");

    const request = new NextRequest("http://localhost:3000/api/stakwork/webhook", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Missing signature header");
  });

  it("should reject request with invalid signature", async () => {
    const payload = createStakworkWebhookPayload(testTask.id, "completed");
    const body = JSON.stringify(payload);

    const request = new NextRequest("http://localhost:3000/api/stakwork/webhook", {
      method: "POST",
      headers: {
        "x-stakwork-signature": "invalid-signature",
      },
      body,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Invalid signature");
  });

  it("should accept request with valid signature", async () => {
    const payload = createStakworkWebhookPayload(testTask.id, "completed");
    const request = createStakworkWebhookRequest(
      "http://localhost:3000/api/stakwork/webhook",
      payload,
      webhookSecret
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toBe("Webhook processed successfully");

    // Verify task was updated
    const updatedTask = await db.task.findUnique({
      where: { id: testTask.id },
    });
    expect(updatedTask?.workflowStatus).toBe("COMPLETED");
  });

  it("should reject request with missing task_id or run_id", async () => {
    const payload = {
      project_status: "completed",
    };
    const body = JSON.stringify(payload);
    const validSignature = computeStakworkWebhookSignature(webhookSecret, body);

    const request = new NextRequest("http://localhost:3000/api/stakwork/webhook", {
      method: "POST",
      headers: {
        "x-stakwork-signature": validSignature,
      },
      body,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("task_id or run_id required");
  });

  it("should reject request for non-existent task", async () => {
    const payload = createStakworkWebhookPayload("non-existent-task-id", "completed");
    const request = createStakworkWebhookRequest(
      "http://localhost:3000/api/stakwork/webhook",
      payload,
      webhookSecret
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Task or workspace not found");
  });

  it("should update workflowStatus based on project_status", async () => {
    // Test each status individually to avoid any state issues
    const testCases = [
      { project_status: "completed", expected: "COMPLETED" },
      { project_status: "failed", expected: "FAILED" },
      { project_status: "in_progress", expected: "IN_PROGRESS" },
    ];

    for (const { project_status, expected } of testCases) {
      // Verify task exists before making request
      const taskBefore = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(taskBefore).not.toBeNull();

      const payload = createStakworkWebhookPayload(testTask.id, project_status);
      const request = createStakworkWebhookRequest(
        "http://localhost:3000/api/stakwork/webhook",
        payload,
        webhookSecret
      );

      const response = await POST(request);
      expect(response.status).toBe(200);

      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask).not.toBeNull();
      expect(updatedTask?.workflowStatus).toBe(expected);
    }
  });

  it("should handle workspace without webhook secret configured", async () => {
    // Create workspace without webhook secret
    const user = await db.user.create({
      data: {
        email: "test2@example.com",
        name: "Test User 2",
      },
    });

    const workspaceNoSecret = await db.workspace.create({
      data: {
        name: "Workspace No Secret",
        slug: "workspace-no-secret",
        ownerId: user.id,
        stakworkWebhookSecret: null,
      },
    });

    const taskNoSecret = await db.task.create({
      data: {
        title: "Task No Secret",
        workspaceId: workspaceNoSecret.id,
        createdById: user.id,
        updatedById: user.id,
        status: "TODO",
        workflowStatus: "PENDING",
      },
    });

    const payload = {
      task_id: taskNoSecret.id,
      project_status: "completed",
    };
    const body = JSON.stringify(payload);

    const request = new NextRequest("http://localhost:3000/api/stakwork/webhook", {
      method: "POST",
      headers: {
        "x-stakwork-signature": "any-signature",
      },
      body,
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Webhook secret not configured for workspace");
  });
});
