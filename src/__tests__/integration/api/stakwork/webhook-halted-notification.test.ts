/**
 * Integration test: WORKFLOW_HALTED notification trigger
 *
 * POSTs a halted status to /api/stakwork/webhook and verifies a
 * notification_triggers row is created with type WORKFLOW_HALTED.
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

    // Allow async notification to settle
    await new Promise((r) => setTimeout(r, 200));

    const record = await db.notificationTrigger.findFirst({
      where: {
        notificationType: NotificationTriggerType.WORKFLOW_HALTED,
        taskId: task.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.targetUserId).toBe(user.id);
    expect(record!.status).toBe(NotificationTriggerStatus.SENT);
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

    await new Promise((r) => setTimeout(r, 200));

    const record = await db.notificationTrigger.findFirst({
      where: {
        notificationType: NotificationTriggerType.WORKFLOW_HALTED,
        featureId: feature.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.targetUserId).toBe(user.id);
    expect(record!.status).toBe(NotificationTriggerStatus.SENT);
  });
});
