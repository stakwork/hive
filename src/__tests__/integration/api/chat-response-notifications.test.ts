/**
 * Integration test: Plan page artifact notifications via /api/chat/response
 *
 * POSTs to /api/chat/response with a FORM artifact + featureId and verifies
 * a notification_triggers row is created with type PLAN_AWAITING_CLARIFICATION.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { POST } from "@/app/api/chat/response/route";
import { NextRequest } from "next/server";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { NotificationTriggerType, NotificationTriggerStatus, PodUsageStatus } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";

// Mock Sphinx delivery
vi.mock("@/lib/sphinx/direct-message", () => ({
  sendDirectMessage: vi.fn().mockResolvedValue({ success: true }),
  isDirectMessageConfigured: vi.fn().mockReturnValue(true),
}));

// Mock Pusher
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getFeatureChannelName: (id: string) => `feature-${id}`,
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (id: string) => `task-${id}`,
  PUSHER_EVENTS: {
    FEATURE_UPDATED: "feature-updated",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    NEW_MESSAGE: "new-message",
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
    PR_STATUS_CHANGE: "pr-status-change",
    DEPLOYMENT_STATUS_CHANGE: "deployment-status-change",
  },
}));

// Stub S3/screenshot helpers
vi.mock("@/lib/screenshot-upload", () => ({
  processScreenshotUpload: vi.fn(),
  processRecordingUpload: vi.fn(),
}));

const API_TOKEN = "test-api-token-123";

function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/chat/response", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": API_TOKEN,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/chat/response — plan artifact notifications", () => {
  let owner: { id: string };
  let workspace: { id: string; slug: string };
  let feature: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    // Set API token env
    process.env.API_TOKEN = API_TOKEN;

    owner = await db.user.create({
      data: { email: "owner@test.com", name: "Owner", lightningPubkey: "test-pubkey-owner" },
    });

    const { createTestWorkspace } = await import("@/__tests__/support/factories/workspace.factory");
    workspace = await createTestWorkspace({
      ownerId: owner.id,
      name: "Test Workspace",
      slug: "test-ws-chat-notif",
    });
    feature = await db.feature.create({
      data: {
        title: "My Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
  });

  afterEach(async () => {
    await resetDatabase();
    delete process.env.API_TOKEN;
  });

  it("creates PLAN_AWAITING_CLARIFICATION notification for FORM artifact with featureId", async () => {
    const req = makeRequest({
      featureId: feature.id,
      message: "What is the form question?",
      artifacts: [{ type: "FORM", content: { question: "Which approach?" } }],
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Allow async notification to settle
    await new Promise((r) => setTimeout(r, 200));

    const record = await db.notificationTrigger.findFirst({
      where: {
        targetUserId: owner.id,
        notificationType: NotificationTriggerType.PLAN_AWAITING_CLARIFICATION,
        featureId: feature.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.status).toBe(NotificationTriggerStatus.PENDING);
    expect(record!.sendAfter).not.toBeNull();
    expect(record!.sendAfter!.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(record!.message).toBeTruthy();
  });

  it("creates PLAN_AWAITING_APPROVAL notification for PLAN artifact with featureId", async () => {
    const req = makeRequest({
      featureId: feature.id,
      message: "Plan ready",
      artifacts: [{ type: "PLAN", content: { plan: "<plan><brief>Test</brief></plan>" } }],
    });

    await POST(req);
    await new Promise((r) => setTimeout(r, 200));

    const record = await db.notificationTrigger.findFirst({
      where: {
        targetUserId: owner.id,
        notificationType: NotificationTriggerType.PLAN_AWAITING_APPROVAL,
        featureId: feature.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.status).toBe(NotificationTriggerStatus.PENDING);
    expect(record!.sendAfter).not.toBeNull();
    expect(record!.sendAfter!.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(record!.message).toBeTruthy();
  });

  it("creates PLAN_TASKS_GENERATED notification for TASKS artifact with featureId", async () => {
    const req = makeRequest({
      featureId: feature.id,
      message: "Tasks generated",
      artifacts: [{ type: "TASKS", content: { tasks: [] } }],
    });

    await POST(req);
    await new Promise((r) => setTimeout(r, 200));

    const record = await db.notificationTrigger.findFirst({
      where: {
        targetUserId: owner.id,
        notificationType: NotificationTriggerType.PLAN_TASKS_GENERATED,
        featureId: feature.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.status).toBe(NotificationTriggerStatus.PENDING);
    expect(record!.sendAfter).not.toBeNull();
    expect(record!.sendAfter!.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(record!.message).toBeTruthy();
  });

  it("creates GRAPH_CHAT_RESPONSE notification for task response without plan artifacts", async () => {
    const task = await db.task.create({
      data: {
        title: "My Task",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        assigneeId: owner.id,
      },
    });

    const req = makeRequest({
      taskId: task.id,
      message: "Here is the answer",
      artifacts: [], // no FORM/PLAN/TASKS
    });

    await POST(req);
    await new Promise((r) => setTimeout(r, 200));

    const record = await db.notificationTrigger.findFirst({
      where: {
        targetUserId: owner.id,
        notificationType: NotificationTriggerType.GRAPH_CHAT_RESPONSE,
        taskId: task.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.status).toBe(NotificationTriggerStatus.PENDING);
    expect(record!.sendAfter).not.toBeNull();
    expect(record!.sendAfter!.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(record!.message).toBeTruthy();
  });

  it("does not mutate task pod fields when an artifact references a nonexistent pod", async () => {
    const task = await db.task.create({
      data: {
        title: "Missing pod task",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const req = makeRequest({
      taskId: task.id,
      message: "IDE opened",
      artifacts: [
        {
          type: "IDE",
          content: {
            url: "https://ide.test",
            podId: "missing-pod-id",
          },
        },
      ],
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const [updatedTask, claimedPodCount] = await Promise.all([
      db.task.findUnique({
        where: { id: task.id },
        select: {
          podId: true,
          agentUrl: true,
          agentPassword: true,
        },
      }),
      db.pod.count({
        where: {
          usageStatusMarkedBy: task.id,
        },
      }),
    ]);

    expect(updatedTask).toEqual({
      podId: null,
      agentUrl: null,
      agentPassword: null,
    });
    expect(claimedPodCount).toBe(0);
  });

  it("attaches a valid artifact pod to the task and mirrors pod usage state", async () => {
    const { createTestSwarm } = await import("@/__tests__/support/factories/swarm.factory");
    const { createTestPod } = await import("@/__tests__/support/factories/pod.factory");
    const encryptionService = EncryptionService.getInstance();

    const swarm = await createTestSwarm({
      workspaceId: workspace.id,
      status: "ACTIVE",
    });

    const pod = await createTestPod({
      swarmId: swarm.id,
      password: "plain-pod-password",
      portMappings: [3000, 15552],
    });

    const task = await db.task.create({
      data: {
        title: "Attach artifact pod task",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const req = makeRequest({
      taskId: task.id,
      message: "IDE opened",
      artifacts: [
        {
          type: "IDE",
          content: {
            url: "https://ide.test",
            podId: pod.podId,
            agentPassword: "artifact-secret",
          },
        },
      ],
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const [updatedTask, updatedPod] = await Promise.all([
      db.task.findUnique({
        where: { id: task.id },
        select: {
          podId: true,
          agentUrl: true,
          agentPassword: true,
        },
      }),
      db.pod.findUnique({
        where: { id: pod.id },
        select: {
          usageStatus: true,
          usageStatusMarkedBy: true,
        },
      }),
    ]);

    expect(updatedTask?.podId).toBe(pod.podId);
    expect(updatedTask?.agentUrl).toBeNull();
    expect(updatedTask?.agentPassword).toBeTruthy();
    expect(encryptionService.decryptField("agentPassword", updatedTask!.agentPassword!)).toBe("artifact-secret");
    expect(updatedPod).toEqual({
      usageStatus: PodUsageStatus.USED,
      usageStatusMarkedBy: task.id,
    });
  });

  it("does not store agentPassword when the task podId points to a missing pod", async () => {
    const task = await db.task.create({
      data: {
        title: "Stale pod task",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        podId: "stale-pod-id",
      },
    });

    const req = makeRequest({
      taskId: task.id,
      message: "IDE reopened",
      artifacts: [
        {
          type: "IDE",
          content: {
            url: "https://ide.test",
            agentPassword: "artifact-secret",
          },
        },
      ],
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const updatedTask = await db.task.findUnique({
      where: { id: task.id },
      select: {
        podId: true,
        agentPassword: true,
      },
    });

    expect(updatedTask).toEqual({
      podId: "stale-pod-id",
      agentPassword: null,
    });
  });
});
