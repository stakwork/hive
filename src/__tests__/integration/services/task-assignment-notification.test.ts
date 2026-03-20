/**
 * Integration test: TASK_ASSIGNED notification trigger
 *
 * Calls updateTicket() with a new human assigneeId and verifies a
 * notification_triggers row is created with type TASK_ASSIGNED.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { updateTicket } from "@/services/roadmap/tickets";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { NotificationTriggerType, NotificationTriggerStatus } from "@prisma/client";

vi.mock("@/lib/sphinx/direct-message", () => ({
  sendDirectMessage: vi.fn().mockResolvedValue({ success: true }),
  isDirectMessageConfigured: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getFeatureChannelName: (id: string) => `feature-${id}`,
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (id: string) => `task-${id}`,
  PUSHER_EVENTS: {
    FEATURE_UPDATED: "feature-updated",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

describe("TASK_ASSIGNED notification", () => {
  let owner: { id: string };
  let assignee: { id: string };
  let workspace: { id: string; slug: string };
  let feature: { id: string };
  let task: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    owner = await db.users.create({
      data: { email: "owner@test.com", name: "Owner" },
    });
    assignee = await db.users.create({
      data: { email: "assignee@test.com", name: "Assignee",lightning_pubkey: "test-pubkey-assignee" },
    });

    const { createTestWorkspace } = await import("@/__tests__/support/factories/workspace.factory");
    workspace = await createTestWorkspace({owner_id: owner.id,
      name: "Test Workspace",
      slug: "test-ws-task-assign",
    });

    await db.workspace_members.create({
      data: {workspace_id: workspace.id,user_id: owner.id, role: "OWNER" },
    });
    feature = await db.features.create({
      data: {
        title: "My Feature",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,
      },
    });
    task = await db.tasks.create({
      data: {
        title: "My Task",workspace_id: workspace.id,feature_id: feature.id,created_by_id: owner.id,updated_by_id: owner.id,
      },
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("creates a TASK_ASSIGNED notification_trigger row when assigning to another user", async () => {
    const { sendDirectMessage } = await import("@/lib/sphinx/direct-message");

    await updateTicket(task.id, owner.id, {assignee_id: assignee.id });

    await new Promise((r) => setTimeout(r, 100));

    const record = await db.notification_triggers.findFirst({
      where: {
        targetUserId: assignee.id,
        notificationType: NotificationTriggerType.TASK_ASSIGNED,task_id: task.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.targetUserId).toBe(assignee.id);
    expect(record!.status).toBe(NotificationTriggerStatus.PENDING);
    expect(record!.sendAfter).not.toBeNull();
    expect(record!.sendAfter!.getTime()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(record!.message).toBeTruthy();
    expect(sendDirectMessage).not.toHaveBeenCalled();
  });

  it("does NOT create a notification when self-assigning", async () => {
    await updateTicket(task.id, owner.id, {assignee_id: owner.id });

    await new Promise((r) => setTimeout(r, 100));

    const records = await db.notification_triggers.findMany({
      where: { notificationType: NotificationTriggerType.TASK_ASSIGNED },
    });

    expect(records).toHaveLength(0);
  });

  it("does NOT create a notification for system assignees", async () => {
    await updateTicket(task.id, owner.id, {assignee_id: "system:task-coordinator" });

    await new Promise((r) => setTimeout(r, 100));

    const records = await db.notification_triggers.findMany({
      where: { notificationType: NotificationTriggerType.TASK_ASSIGNED },
    });

    expect(records).toHaveLength(0);
  });
});

describe("TASK_ASSIGNED notification — DM not configured (no lightningPubkey)", () => {
  let owner: { id: string };
  let assignee: { id: string };
  let workspace: { id: string; slug: string };
  let task: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    owner = await db.users.create({
      data: { email: "owner2@test.com", name: "Owner2" },
    });
    assignee = await db.users.create({
      data: { email: "assignee2@test.com", name: "Assignee2" },
    });

    // Plain workspace — no Sphinx config
    const { createTestWorkspace } = await import("@/__tests__/support/factories/workspace.factory");
    workspace = await createTestWorkspace({owner_id: owner.id,
      name: "No Sphinx Workspace",
      slug: "test-ws-no-sphinx",
    });

    await db.workspace_members.create({
      data: {workspace_id: workspace.id,user_id: owner.id, role: "OWNER" },
    });

    const feature = await db.features.create({
      data: {
        title: "My Feature",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,
      },
    });

    task = await db.tasks.create({
      data: {
        title: "My Task",workspace_id: workspace.id,feature_id: feature.id,created_by_id: owner.id,updated_by_id: owner.id,
      },
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("creates a SKIPPED notification_trigger row when user has no lightningPubkey", async () => {
    await updateTicket(task.id, owner.id, {assignee_id: assignee.id });

    await new Promise((r) => setTimeout(r, 100));

    const record = await db.notification_triggers.findFirst({
      where: {
        targetUserId: assignee.id,
        notificationType: NotificationTriggerType.TASK_ASSIGNED,task_id: task.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.status).toBe(NotificationTriggerStatus.SKIPPED);
    expect(record!.sendAfter).toBeNull();
  });
});
