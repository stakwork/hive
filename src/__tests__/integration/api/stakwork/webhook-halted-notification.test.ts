/**
 * Integration test: WORKFLOW_HALTED notification trigger + pod release
 *
 * POSTs a halted status to /api/stakwork/webhook and verifies:
 * 1. A notification_triggers row is created with type WORKFLOW_HALTED.
 * 2. Non-agent tasks with a pod have releaseTaskPod called.
 * 3. Agent tasks with a pod do NOT have releaseTaskPod called.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { POST } from "@/app/api/stakwork/webhook/route";
import { NextRequest } from "next/server";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { NotificationTriggerType, NotificationTriggerStatus, TaskStatus } from "@prisma/client";
import { generateUniqueId, generateUniqueSlug } from "@/__tests__/support/helpers";

// Mock Sphinx so no HTTP calls are made
vi.mock("@/lib/sphinx/direct-message", () => ({
  sendDirectMessage: vi.fn().mockResolvedValue({ success: true }),
  isDirectMessageConfigured: vi.fn().mockReturnValue(true),
}));

// Mock Pusher
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getTaskChannelName: (id: string) => `task-${id}`,
  getFeatureChannelName: (id: string) => `feature-${id}`,
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
  },
}));

// Mock feature-status-sync so it doesn't cascade
vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn().mockResolvedValue(undefined),
}));

// Mock canvas helpers
vi.mock("@/lib/canvas", () => ({
  notifyFeatureCanvasRefresh: vi.fn().mockResolvedValue(undefined),
}));

// Mock releaseTaskPod — preserve other exports so the real implementation
// is used when not explicitly mocked (we override per-test when needed).
vi.mock("@/lib/pods/utils", async () => {
  const actual = await vi.importActual("@/lib/pods/utils");
  return { ...actual, releaseTaskPod: vi.fn().mockResolvedValue({ success: true, podDropped: true, taskCleared: true }) };
});

import { releaseTaskPod } from "@/lib/pods/utils";

/** Poll DB until a matching record appears (avoids flaky fixed-delay waits). */
async function waitForNotification(
  where: Record<string, unknown>,
  timeoutMs = 5000,
  intervalMs = 100,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record = await db.notificationTrigger.findFirst({ where: where as any });
    if (record) return record;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

function makeRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/stakwork/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/stakwork/webhook — WORKFLOW_HALTED notification", () => {
  let user: { id: string };
  let workspace: { id: string; slug: string };

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    user = await db.user.create({
      data: { email: "owner@test.com", name: "Owner", lightningPubkey: "test-pubkey-owner" },
    });

    const { createTestWorkspace } = await import("@/__tests__/support/factories/workspace.factory");
    workspace = await createTestWorkspace({
      ownerId: user.id,
      slug: generateUniqueSlug("ws-halted"),
    });

    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("creates a WORKFLOW_HALTED notification for task path", async () => {
    const task = await db.task.create({
      data: {
        title: "Halted Task",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status: TaskStatus.IN_PROGRESS,
      },
    });

    const req = makeRequest({ task_id: task.id, project_status: "HALTED" });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const record = await waitForNotification({
      notificationType: NotificationTriggerType.WORKFLOW_HALTED,
      taskId: task.id,
    });

    expect(record).not.toBeNull();
    expect(record!.targetUserId).toBe(user.id);
    expect(record!.status).toBe(NotificationTriggerStatus.PENDING);
    expect(record!.sendAfter).not.toBeNull();
    expect(record!.sendAfter!.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(record!.message).toBeTruthy();
    // Message separator is `: ` so buildPushMessage can strip the URL cleanly
    expect(record!.message).toMatch(/needs your attention: https?:\/\//);
  });

  it("creates a WORKFLOW_HALTED notification for feature (plan mode) path", async () => {
    const feature = await db.feature.create({
      data: {
        title: "Halted Feature",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // In plan mode, the featureId is passed as task_id
    const req = makeRequest({ task_id: feature.id, project_status: "HALTED" });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const record = await waitForNotification({
      notificationType: NotificationTriggerType.WORKFLOW_HALTED,
      featureId: feature.id,
    });

    expect(record).not.toBeNull();
    expect(record!.targetUserId).toBe(user.id);
    expect(record!.status).toBe(NotificationTriggerStatus.PENDING);
    expect(record!.sendAfter).not.toBeNull();
    expect(record!.sendAfter!.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(record!.message).toBeTruthy();
    // Message separator is `: ` so buildPushMessage can strip the URL cleanly
    expect(record!.message).toMatch(/needs your attention: https?:\/\//);
  });

  it("does NOT call releaseTaskPod when task has no pod (existing behavior unchanged)", async () => {
    const task = await db.task.create({
      data: {
        title: "No-Pod Halted Task",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status: TaskStatus.IN_PROGRESS,
        // podId intentionally omitted
      },
    });

    const req = makeRequest({ task_id: task.id, project_status: "HALTED" });
    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(releaseTaskPod).not.toHaveBeenCalled();
  });

  it("calls releaseTaskPod with correct args for non-agent task with pod on HALTED", async () => {
    // Create a swarm so we can attach a pod to it
    const { createTestSwarm } = await import("@/__tests__/support/factories/swarm.factory");
    const { createTestPod } = await import("@/__tests__/support/factories/pod.factory");
    const swarm = await createTestSwarm({ workspaceId: workspace.id });
    const pod = await createTestPod({ swarmId: swarm.id, usageStatus: "USED" });

    const task = await db.task.create({
      data: {
        title: "Live Task With Pod",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status: TaskStatus.IN_PROGRESS,
        mode: "live",
        podId: pod.podId,
      },
    });

    const req = makeRequest({ task_id: task.id, project_status: "HALTED" });
    const res = await POST(req);
    expect(res.status).toBe(200);

    // Give the fire-and-forget a tick to execute
    await new Promise((r) => setTimeout(r, 50));

    expect(releaseTaskPod).toHaveBeenCalledOnce();
    expect(releaseTaskPod).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.id,
        podId: pod.podId,
        workspaceId: task.workspaceId,
        newWorkflowStatus: null,
      }),
    );
  });

  it("does NOT call releaseTaskPod for agent-mode task with pod on HALTED", async () => {
    const { createTestSwarm } = await import("@/__tests__/support/factories/swarm.factory");
    const { createTestPod } = await import("@/__tests__/support/factories/pod.factory");
    const swarm = await createTestSwarm({ workspaceId: workspace.id });
    const pod = await createTestPod({ swarmId: swarm.id, usageStatus: "USED" });

    const task = await db.task.create({
      data: {
        title: "Agent Task With Pod",
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
        status: TaskStatus.IN_PROGRESS,
        mode: "agent",
        podId: pod.podId,
      },
    });

    const req = makeRequest({ task_id: task.id, project_status: "HALTED" });
    const res = await POST(req);
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 50));

    expect(releaseTaskPod).not.toHaveBeenCalled();
  });
});
