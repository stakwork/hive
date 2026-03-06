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

vi.mock("@/lib/sphinx/daily-pr-summary", () => ({
  sendToSphinx: vi.fn().mockResolvedValue({ success: true }),
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

    owner = await db.user.create({
      data: { email: "owner@test.com", name: "Owner" },
    });
    assignee = await db.user.create({
      data: { email: "assignee@test.com", name: "Assignee", sphinxAlias: "assignee-alias" },
    });

    const { createSphinxEnabledWorkspace } = await import("@/__tests__/support/factories/workspace.factory");
    workspace = await createSphinxEnabledWorkspace({
      ownerId: owner.id,
      name: "Test Workspace",
      slug: "test-ws-task-assign",
    });

    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: "OWNER" },
    });
    feature = await db.feature.create({
      data: {
        title: "My Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
    task = await db.task.create({
      data: {
        title: "My Task",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("creates a TASK_ASSIGNED notification_trigger row when assigning to another user", async () => {
    await updateTicket(task.id, owner.id, { assigneeId: assignee.id });

    await new Promise((r) => setTimeout(r, 100));

    const record = await db.notificationTrigger.findFirst({
      where: {
        targetUserId: assignee.id,
        notificationType: NotificationTriggerType.TASK_ASSIGNED,
        taskId: task.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.targetUserId).toBe(assignee.id);
    expect(record!.status).toBe(NotificationTriggerStatus.SENT);
  });

  it("does NOT create a notification when self-assigning", async () => {
    await updateTicket(task.id, owner.id, { assigneeId: owner.id });

    await new Promise((r) => setTimeout(r, 100));

    const records = await db.notificationTrigger.findMany({
      where: { notificationType: NotificationTriggerType.TASK_ASSIGNED },
    });

    expect(records).toHaveLength(0);
  });

  it("does NOT create a notification for system assignees", async () => {
    await updateTicket(task.id, owner.id, { assigneeId: "system:task-coordinator" });

    await new Promise((r) => setTimeout(r, 100));

    const records = await db.notificationTrigger.findMany({
      where: { notificationType: NotificationTriggerType.TASK_ASSIGNED },
    });

    expect(records).toHaveLength(0);
  });
});

describe("TASK_ASSIGNED notification — Sphinx disabled workspace", () => {
  let owner: { id: string };
  let assignee: { id: string };
  let workspace: { id: string; slug: string };
  let task: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    owner = await db.user.create({
      data: { email: "owner2@test.com", name: "Owner2" },
    });
    assignee = await db.user.create({
      data: { email: "assignee2@test.com", name: "Assignee2", sphinxAlias: "assignee2-alias" },
    });

    // Plain workspace — no Sphinx config
    const { createTestWorkspace } = await import("@/__tests__/support/factories/workspace.factory");
    workspace = await createTestWorkspace({
      ownerId: owner.id,
      name: "No Sphinx Workspace",
      slug: "test-ws-no-sphinx",
    });

    await db.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: owner.id, role: "OWNER" },
    });

    const feature = await db.feature.create({
      data: {
        title: "My Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    task = await db.task.create({
      data: {
        title: "My Task",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("creates a SKIPPED notification_trigger row when Sphinx is not configured", async () => {
    await updateTicket(task.id, owner.id, { assigneeId: assignee.id });

    await new Promise((r) => setTimeout(r, 100));

    const record = await db.notificationTrigger.findFirst({
      where: {
        targetUserId: assignee.id,
        notificationType: NotificationTriggerType.TASK_ASSIGNED,
        taskId: task.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.status).toBe(NotificationTriggerStatus.SKIPPED);
  });
});
