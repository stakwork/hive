import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkflowStatus } from "@prisma/client";
import { POST } from "@/app/api/stakwork/webhook/route";
import { invokeRoute } from "@/__tests__/harness/route";

// Mock dependencies
vi.mock("next-auth/next");
vi.mock("@/lib/db");
vi.mock("@/utils/conversions");
vi.mock("@/lib/pusher");

// Import mocked modules
import { db } from "@/lib/db";
import { mapStakworkStatus } from "@/utils/conversions";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

// Import centralized fixtures and helpers
import {
  createMockTask,
  createWebhookPayload,
  StakworkWebhookFixtures,
  StakworkTaskFixtures,
} from "@/__tests__/support/fixtures/stakwork";
import {
  setupDatabaseMocks,
  setupStatusMapping,
  setupPusherMock,
  StakworkWebhookTestScenarios,
} from "@/__tests__/support/helpers/stakwork-webhook";

describe("POST /api/stakwork/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupPusherMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Validation", () => {
    it("should return 400 when task_id is missing from both body and query params", async () => {
      const payload = createWebhookPayload({ task_id: undefined });

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(status).toBe(400);
      const data = await json();
      expect(data).toEqual({ error: "task_id is required" });
      expect(db.task.findFirst).not.toHaveBeenCalled();
    });

    it("should accept task_id from query parameter when not in body", async () => {
      const payload = createWebhookPayload({ task_id: undefined });
      setupDatabaseMocks();
      setupStatusMapping("completed", WorkflowStatus.COMPLETED);

      const { status } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook?task_id=query-task-id",
        body: payload,
      });

      expect(status).toBe(200);
      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: "query-task-id",
          deleted: false,
        },
      });
    });

    it("should prioritize task_id from body over query parameter", async () => {
      const payload = createWebhookPayload({ task_id: "body-task-id" });
      setupDatabaseMocks();
      setupStatusMapping("completed", WorkflowStatus.COMPLETED);

      const { status } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook?task_id=query-task-id",
        body: payload,
      });

      expect(status).toBe(200);
      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: "body-task-id",
          deleted: false,
        },
      });
    });

    it("should return 400 when project_status is missing", async () => {
      const payload = createWebhookPayload({ project_status: undefined });

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(status).toBe(400);
      const data = await json();
      expect(data).toEqual({ error: "project_status is required" });
      expect(db.task.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("Task lookup", () => {
    it("should return 404 when task is not found", async () => {
      const payload = createWebhookPayload();
      vi.mocked(db.task.findFirst).mockResolvedValue(null);

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(status).toBe(404);
      const data = await json();
      expect(data).toEqual({ error: "Task not found" });
      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: "test-task-id",
          deleted: false,
        },
      });
      expect(db.task.update).not.toHaveBeenCalled();
    });

    it("should query for non-deleted tasks only", async () => {
      const payload = createWebhookPayload();
      setupDatabaseMocks();
      setupStatusMapping("completed", WorkflowStatus.COMPLETED);

      await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: "test-task-id",
          deleted: false,
        },
      });
    });
  });

  describe("Status mapping", () => {
    it("should return 200 with ignored action for unknown status", async () => {
      const payload = createWebhookPayload({ project_status: "unknown_status" });
      const { mockTask } = setupDatabaseMocks();
      setupStatusMapping("unknown_status", null);

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(status).toBe(200);
      const data = await json();
      expect(data).toEqual({
        success: true,
        message: "Unknown status 'unknown_status' - no update performed",
        data: {
          taskId: "test-task-id",
          receivedStatus: "unknown_status",
          action: "ignored",
        },
      });
      expect(db.task.update).not.toHaveBeenCalled();
      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });

    it("should map valid status and proceed with update", async () => {
      const payload = createWebhookPayload({ project_status: "completed" });
      setupDatabaseMocks();
      setupStatusMapping("completed", WorkflowStatus.COMPLETED);

      const { status } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(status).toBe(200);
      expect(mapStakworkStatus).toHaveBeenCalledWith("completed");
      expect(db.task.update).toHaveBeenCalled();
    });
  });

  describe("Task updates", () => {
    it("should set workflowStartedAt when status is IN_PROGRESS", async () => {
      const payload = createWebhookPayload({ project_status: "in_progress" });
      const { mockTask } = setupDatabaseMocks();
      setupStatusMapping("in_progress", WorkflowStatus.IN_PROGRESS);

      const beforeUpdate = new Date();
      await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });
      const afterUpdate = new Date();

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "test-task-id" },
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      });

      const updateCall = vi.mocked(db.task.update).mock.calls[0][0];
      const startedAt = updateCall.data.workflowStartedAt as Date;
      expect(startedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
      expect(startedAt.getTime()).toBeLessThanOrEqual(afterUpdate.getTime());
    });

    it("should set workflowCompletedAt when status is COMPLETED", async () => {
      const payload = createWebhookPayload({ project_status: "completed" });
      setupDatabaseMocks();
      setupStatusMapping("completed", WorkflowStatus.COMPLETED);

      const beforeUpdate = new Date();
      await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });
      const afterUpdate = new Date();

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "test-task-id" },
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.COMPLETED,
          workflowCompletedAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      });

      const updateCall = vi.mocked(db.task.update).mock.calls[0][0];
      const completedAt = updateCall.data.workflowCompletedAt as Date;
      expect(completedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
      expect(completedAt.getTime()).toBeLessThanOrEqual(afterUpdate.getTime());
    });

    it("should set workflowCompletedAt when status is FAILED", async () => {
      const payload = createWebhookPayload({ project_status: "failed" });
      setupDatabaseMocks();
      setupStatusMapping("failed", WorkflowStatus.FAILED);

      await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "test-task-id" },
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.FAILED,
          workflowCompletedAt: expect.any(Date),
        }),
      });
    });

    it("should set workflowCompletedAt when status is HALTED", async () => {
      const payload = createWebhookPayload({ project_status: "halted" });
      setupDatabaseMocks();
      setupStatusMapping("halted", WorkflowStatus.HALTED);

      await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "test-task-id" },
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.HALTED,
          workflowCompletedAt: expect.any(Date),
        }),
      });
    });

    it("should update task with correct workflow status", async () => {
      const payload = createWebhookPayload({ project_status: "completed" });
      setupDatabaseMocks();
      setupStatusMapping("completed", WorkflowStatus.COMPLETED);

      await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "test-task-id" },
        data: expect.objectContaining({
          workflowStatus: WorkflowStatus.COMPLETED,
          updatedAt: expect.any(Date),
        }),
      });
    });
  });

  describe("Pusher notifications", () => {
    it("should broadcast workflow status update to Pusher", async () => {
      const payload = createWebhookPayload({ project_status: "completed" });
      const { mockUpdatedTask } = setupDatabaseMocks();
      setupStatusMapping("completed", WorkflowStatus.COMPLETED);

      await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(getTaskChannelName).toHaveBeenCalledWith("test-task-id");
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        "task-test-task-id",
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        expect.objectContaining({
          taskId: "test-task-id",
          workflowStatus: WorkflowStatus.COMPLETED,
          timestamp: expect.any(Date),
        })
      );
    });

    it("should not fail the request when Pusher broadcast fails", async () => {
      const payload = createWebhookPayload({ project_status: "completed" });
      setupDatabaseMocks();
      setupStatusMapping("completed", WorkflowStatus.COMPLETED);
      vi.mocked(pusherServer.trigger).mockRejectedValue(new Error("Pusher error"));

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(status).toBe(200);
      const data = await json();
      expect(data.success).toBe(true);
      expect(data.data.taskId).toBe("test-task-id");
    });

    it("should include workflow timestamps in Pusher payload", async () => {
      const payload = createWebhookPayload({ project_status: "in_progress" });
      const mockUpdatedTask = createMockTask({
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        workflowStartedAt: new Date("2024-01-15T10:00:00Z"),
        workflowCompletedAt: null,
      });
      vi.mocked(db.task.findFirst).mockResolvedValue(createMockTask());
      vi.mocked(db.task.update).mockResolvedValue(mockUpdatedTask);
      setupStatusMapping("in_progress", WorkflowStatus.IN_PROGRESS);

      await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          workflowStartedAt: mockUpdatedTask.workflowStartedAt,
          workflowCompletedAt: mockUpdatedTask.workflowCompletedAt,
        })
      );
    });
  });

  describe("Success responses", () => {
    it("should return success response with task data", async () => {
      const payload = createWebhookPayload({ project_status: "completed" });
      const { mockTask } = setupDatabaseMocks();
      setupStatusMapping("completed", WorkflowStatus.COMPLETED);

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(status).toBe(200);
      const data = await json();
      expect(data).toEqual({
        success: true,
        data: {
          taskId: "test-task-id",
          workflowStatus: WorkflowStatus.COMPLETED,
          previousStatus: mockTask.workflowStatus,
        },
      });
    });

    it("should include previous status in response", async () => {
      const payload = createWebhookPayload({ project_status: "completed" });
      const mockTask = createMockTask({
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });
      vi.mocked(db.task.findFirst).mockResolvedValue(mockTask);
      vi.mocked(db.task.update).mockResolvedValue(
        createMockTask({ workflowStatus: WorkflowStatus.COMPLETED })
      );
      setupStatusMapping("completed", WorkflowStatus.COMPLETED);

      const { json } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      const data = await json();
      expect(data.data.previousStatus).toBe(WorkflowStatus.IN_PROGRESS);
    });
  });

  describe("Error handling", () => {
    it("should return 500 when database operation fails", async () => {
      const payload = createWebhookPayload({ project_status: "completed" });
      vi.mocked(db.task.findFirst).mockRejectedValue(new Error("Database error"));

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(status).toBe(500);
      const data = await json();
      expect(data).toEqual({ error: "Failed to process webhook" });
    });

    it("should return 500 when task update fails", async () => {
      const payload = createWebhookPayload({ project_status: "completed" });
      setupDatabaseMocks();
      setupStatusMapping("completed", WorkflowStatus.COMPLETED);
      vi.mocked(db.task.update).mockRejectedValue(new Error("Update failed"));

      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: payload,
      });

      expect(status).toBe(500);
      const data = await json();
      expect(data).toEqual({ error: "Failed to process webhook" });
    });

    it("should return 500 when JSON parsing fails", async () => {
      const { status, json } = await invokeRoute(POST, {
        method: "POST",
        url: "http://localhost/api/stakwork/webhook",
        body: "invalid json",
        headers: {
          "Content-Type": "application/json",
        },
      });

      expect(status).toBe(500);
      const data = await json();
      expect(data).toEqual({ error: "Failed to process webhook" });
    });
  });
});