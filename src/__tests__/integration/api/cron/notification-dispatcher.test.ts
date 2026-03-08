import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  NotificationMethod,
  NotificationTriggerStatus,
  NotificationTriggerType,
  TaskStatus,
  WorkflowStatus,
} from "@prisma/client";
import { GET } from "@/app/api/cron/notification-dispatcher/route";
import { NextRequest } from "next/server";
import { resetDatabase } from "@/__tests__/support/utilities/database";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/sphinx/direct-message", () => ({
  sendDirectMessage: vi.fn().mockResolvedValue({ success: true }),
  isDirectMessageConfigured: vi.fn().mockReturnValue(true),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function createCronRequest(secret = "test-cron-secret"): NextRequest {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${secret}`);
  return new NextRequest(
    "http://localhost:3000/api/cron/notification-dispatcher",
    { headers }
  );
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function createBaseScenario() {
  const owner = await db.user.create({
    data: {
      email: "dispatcher-owner@test.com",
      name: "Owner",
      lightningPubkey: "pubkey-owner-123",
    },
  });

  const workspace = await db.workspace.create({
    data: {
      name: "Dispatcher Test Workspace",
      slug: `dispatcher-ws-${Date.now()}`,
      ownerId: owner.id,
    },
  });

  return { owner, workspace };
}

async function createPendingNotification(opts: {
  targetUserId: string;
  taskId?: string;
  featureId?: string;
  notificationType: NotificationTriggerType;
  sendAfter: Date;
  message?: string;
}) {
  return db.notificationTrigger.create({
    data: {
      targetUserId: opts.targetUserId,
      taskId: opts.taskId ?? null,
      featureId: opts.featureId ?? null,
      notificationType: opts.notificationType,
      status: NotificationTriggerStatus.PENDING,
      notificationMethod: NotificationMethod.SPHINX,
      notificationTimestamps: [],
      sendAfter: opts.sendAfter,
      message: opts.message ?? "Test notification message",
    },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/cron/notification-dispatcher", () => {
  let originalCronSecret: string | undefined;
  let originalDispatcherEnabled: string | undefined;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    originalCronSecret = process.env.CRON_SECRET;
    originalDispatcherEnabled = process.env.NOTIFICATION_DISPATCHER_ENABLED;

    process.env.CRON_SECRET = "test-cron-secret";
    process.env.NOTIFICATION_DISPATCHER_ENABLED = "true";
  });

  afterEach(async () => {
    // Restore env vars
    if (originalCronSecret !== undefined) {
      process.env.CRON_SECRET = originalCronSecret;
    } else {
      delete process.env.CRON_SECRET;
    }
    if (originalDispatcherEnabled !== undefined) {
      process.env.NOTIFICATION_DISPATCHER_ENABLED = originalDispatcherEnabled;
    } else {
      delete process.env.NOTIFICATION_DISPATCHER_ENABLED;
    }

    await resetDatabase();
  });

  // ── Auth guard ──────────────────────────────────────────────────────────────

  test("returns 401 when Authorization header is missing", async () => {
    const req = new NextRequest(
      "http://localhost:3000/api/cron/notification-dispatcher"
    );
    const response = await GET(req);
    expect(response.status).toBe(401);
  });

  test("returns 401 when CRON_SECRET does not match", async () => {
    const req = createCronRequest("wrong-secret");
    const response = await GET(req);
    expect(response.status).toBe(401);
  });

  // ── Feature flag guard ──────────────────────────────────────────────────────

  test("returns early with disabled message when NOTIFICATION_DISPATCHER_ENABLED is not 'true'", async () => {
    delete process.env.NOTIFICATION_DISPATCHER_ENABLED;

    const { owner, workspace } = await createBaseScenario();

    // Create a due pending record that would be processed
    const task = await db.task.create({
      data: {
        title: "Test Task",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: TaskStatus.IN_PROGRESS,
      },
    });
    await createPendingNotification({
      targetUserId: owner.id,
      taskId: task.id,
      notificationType: NotificationTriggerType.TASK_ASSIGNED,
      sendAfter: new Date(Date.now() - 60_000), // 1 minute ago
    });

    const req = createCronRequest();
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe("Notification dispatcher is disabled");
    expect(body.dispatched).toBe(0);
    expect(body.cancelled).toBe(0);

    // Record must be untouched
    const { sendDirectMessage } = await import("@/lib/sphinx/direct-message");
    expect(sendDirectMessage).not.toHaveBeenCalled();

    const record = await db.notificationTrigger.findFirst({
      where: { taskId: task.id },
    });
    expect(record?.status).toBe(NotificationTriggerStatus.PENDING);
  });

  // ── Future records ignored ──────────────────────────────────────────────────

  test("does NOT process a PENDING record whose sendAfter is in the future", async () => {
    const { owner, workspace } = await createBaseScenario();

    const task = await db.task.create({
      data: {
        title: "Future Task",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: TaskStatus.IN_PROGRESS,
      },
    });
    await createPendingNotification({
      targetUserId: owner.id,
      taskId: task.id,
      notificationType: NotificationTriggerType.TASK_ASSIGNED,
      sendAfter: new Date(Date.now() + 10 * 60_000), // 10 minutes in the future
    });

    const req = createCronRequest();
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dispatched).toBe(0);
    expect(body.cancelled).toBe(0);

    const record = await db.notificationTrigger.findFirst({
      where: { taskId: task.id },
    });
    expect(record?.status).toBe(NotificationTriggerStatus.PENDING);
  });

  // ── Task-linked: cancellation path ─────────────────────────────────────────

  test("cancels TASK_ASSIGNED notification when task.status is DONE", async () => {
    const { owner, workspace } = await createBaseScenario();

    const task = await db.task.create({
      data: {
        title: "Done Task",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: TaskStatus.DONE,
      },
    });
    const notification = await createPendingNotification({
      targetUserId: owner.id,
      taskId: task.id,
      notificationType: NotificationTriggerType.TASK_ASSIGNED,
      sendAfter: new Date(Date.now() - 60_000), // 1 minute ago
      message: "test msg",
    });

    const req = createCronRequest();
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.cancelled).toBe(1);
    expect(body.dispatched).toBe(0);

    const { sendDirectMessage } = await import("@/lib/sphinx/direct-message");
    expect(sendDirectMessage).not.toHaveBeenCalled();

    const updated = await db.notificationTrigger.findUnique({
      where: { id: notification.id },
    });
    expect(updated?.status).toBe(NotificationTriggerStatus.CANCELLED);
  });

  test("cancels TASK_ASSIGNED notification when task.status is CANCELLED", async () => {
    const { owner, workspace } = await createBaseScenario();

    const task = await db.task.create({
      data: {
        title: "Cancelled Task",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: TaskStatus.CANCELLED,
      },
    });
    const notification = await createPendingNotification({
      targetUserId: owner.id,
      taskId: task.id,
      notificationType: NotificationTriggerType.TASK_ASSIGNED,
      sendAfter: new Date(Date.now() - 60_000),
    });

    await GET(createCronRequest());

    const updated = await db.notificationTrigger.findUnique({
      where: { id: notification.id },
    });
    expect(updated?.status).toBe(NotificationTriggerStatus.CANCELLED);
  });

  // ── Task-linked: send path ──────────────────────────────────────────────────

  test("sends TASK_ASSIGNED notification when task.status is IN_PROGRESS", async () => {
    const { owner, workspace } = await createBaseScenario();

    const task = await db.task.create({
      data: {
        title: "Active Task",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: TaskStatus.IN_PROGRESS,
      },
    });
    const notification = await createPendingNotification({
      targetUserId: owner.id,
      taskId: task.id,
      notificationType: NotificationTriggerType.TASK_ASSIGNED,
      sendAfter: new Date(Date.now() - 60_000),
      message: "You have been assigned a task",
    });

    const req = createCronRequest();
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dispatched).toBe(1);
    expect(body.cancelled).toBe(0);

    const { sendDirectMessage } = await import("@/lib/sphinx/direct-message");
    expect(sendDirectMessage).toHaveBeenCalledOnce();
    expect(sendDirectMessage).toHaveBeenCalledWith(
      "pubkey-owner-123",
      "You have been assigned a task",
      { routeHint: undefined },
    );

    const updated = await db.notificationTrigger.findUnique({
      where: { id: notification.id },
    });
    expect(updated?.status).toBe(NotificationTriggerStatus.SENT);
    expect(updated?.notificationTimestamps).toHaveLength(1);
  });

  // ── Feature-linked WORKFLOW_HALTED: cancellation ────────────────────────────

  test("cancels WORKFLOW_HALTED notification when feature.workflowStatus is IN_PROGRESS", async () => {
    const { owner, workspace } = await createBaseScenario();

    const feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      },
    });
    const notification = await createPendingNotification({
      targetUserId: owner.id,
      featureId: feature.id,
      notificationType: NotificationTriggerType.WORKFLOW_HALTED,
      sendAfter: new Date(Date.now() - 60_000),
      message: "Workflow was halted",
    });

    const req = createCronRequest();
    const response = await GET(req);
    const body = await response.json();

    expect(body.cancelled).toBe(1);
    expect(body.dispatched).toBe(0);

    const { sendDirectMessage } = await import("@/lib/sphinx/direct-message");
    expect(sendDirectMessage).not.toHaveBeenCalled();

    const updated = await db.notificationTrigger.findUnique({
      where: { id: notification.id },
    });
    expect(updated?.status).toBe(NotificationTriggerStatus.CANCELLED);
  });

  // ── Feature-linked WORKFLOW_HALTED: send ────────────────────────────────────

  test("sends WORKFLOW_HALTED notification when feature.workflowStatus is still HALTED", async () => {
    const { owner, workspace } = await createBaseScenario();

    const feature = await db.feature.create({
      data: {
        title: "Halted Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        workflowStatus: WorkflowStatus.HALTED,
      },
    });
    const notification = await createPendingNotification({
      targetUserId: owner.id,
      featureId: feature.id,
      notificationType: NotificationTriggerType.WORKFLOW_HALTED,
      sendAfter: new Date(Date.now() - 60_000),
      message: "Workflow is halted, please review",
    });

    const req = createCronRequest();
    const response = await GET(req);
    const body = await response.json();

    expect(body.dispatched).toBe(1);
    expect(body.cancelled).toBe(0);

    const { sendDirectMessage } = await import("@/lib/sphinx/direct-message");
    expect(sendDirectMessage).toHaveBeenCalledOnce();
    expect(sendDirectMessage).toHaveBeenCalledWith(
      "pubkey-owner-123",
      "Workflow is halted, please review",
      { routeHint: undefined },
    );

    const updated = await db.notificationTrigger.findUnique({
      where: { id: notification.id },
    });
    expect(updated?.status).toBe(NotificationTriggerStatus.SENT);
  });

  // ── PLAN_AWAITING_CLARIFICATION ─────────────────────────────────────────────

  test("cancels PLAN_AWAITING_CLARIFICATION when feature.workflowStatus is no longer HALTED", async () => {
    const { owner, workspace } = await createBaseScenario();

    const feature = await db.feature.create({
      data: {
        title: "Resumed Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      },
    });
    const notification = await createPendingNotification({
      targetUserId: owner.id,
      featureId: feature.id,
      notificationType: NotificationTriggerType.PLAN_AWAITING_CLARIFICATION,
      sendAfter: new Date(Date.now() - 60_000),
    });

    await GET(createCronRequest());

    const updated = await db.notificationTrigger.findUnique({
      where: { id: notification.id },
    });
    expect(updated?.status).toBe(NotificationTriggerStatus.CANCELLED);
  });

  // ── GRAPH_CHAT_RESPONSE ─────────────────────────────────────────────────────

  test("cancels GRAPH_CHAT_RESPONSE when task.status is DONE", async () => {
    const { owner, workspace } = await createBaseScenario();

    const task = await db.task.create({
      data: {
        title: "Done Task",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: TaskStatus.DONE,
      },
    });
    const notification = await createPendingNotification({
      targetUserId: owner.id,
      taskId: task.id,
      notificationType: NotificationTriggerType.GRAPH_CHAT_RESPONSE,
      sendAfter: new Date(Date.now() - 60_000),
    });

    await GET(createCronRequest());

    const updated = await db.notificationTrigger.findUnique({
      where: { id: notification.id },
    });
    expect(updated?.status).toBe(NotificationTriggerStatus.CANCELLED);
  });

  // ── Response shape ──────────────────────────────────────────────────────────

  test("returns correct stats shape", async () => {
    const req = createCronRequest();
    const response = await GET(req);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("success");
    expect(body).toHaveProperty("dispatched");
    expect(body).toHaveProperty("cancelled");
    expect(body).toHaveProperty("failed");
    expect(body).toHaveProperty("errors");
    expect(body).toHaveProperty("timestamp");
    expect(typeof body.dispatched).toBe("number");
    expect(Array.isArray(body.errors)).toBe(true);
  });
});
