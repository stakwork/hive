/**
 * Integration test: FEATURE_COMPLETED notification trigger
 *
 * Triggers updateFeatureStatusFromTasks() where all tasks are DONE/COMPLETED
 * and verifies a notification_triggers row is created with type FEATURE_COMPLETED.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { updateFeatureStatusFromTasks } from "@/services/roadmap/feature-status-sync";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { NotificationTriggerType, NotificationTriggerStatus, TaskStatus, WorkflowStatus } from "@prisma/client";

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

describe("FEATURE_COMPLETED notification", () => {
  let owner: { id: string };
  let assignee: { id: string };
  let workspace: { id: string; slug: string };
  let feature: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    owner = await db.user.create({
      data: { email: "owner@test.com", name: "Owner", lightningPubkey: "test-pubkey-owner" },
    });
    assignee = await db.user.create({
      data: { email: "assignee@test.com", name: "Assignee", lightningPubkey: "test-pubkey-assignee" },
    });

    const { createTestWorkspace } = await import("@/__tests__/support/factories/workspace.factory");
    workspace = await createTestWorkspace({
      ownerId: owner.id,
      name: "Test Workspace",
      slug: "test-ws-feat-complete",
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
        assigneeId: assignee.id,
        status: "IN_PROGRESS",
      },
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("creates a FEATURE_COMPLETED notification when all tasks are DONE", async () => {
    // Create tasks that are all DONE with COMPLETED workflow status
    await db.task.create({
      data: {
        title: "Task 1",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
      },
    });
    await db.task.create({
      data: {
        title: "Task 2",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
      },
    });

    await updateFeatureStatusFromTasks(feature.id);

    // Give async fire-and-forget a moment to settle
    await new Promise((r) => setTimeout(r, 200));

    const record = await db.notificationTrigger.findFirst({
      where: {
        notificationType: NotificationTriggerType.FEATURE_COMPLETED,
        featureId: feature.id,
      },
    });

    expect(record).not.toBeNull();
    // Target should be the feature's assigneeId
    expect(record!.targetUserId).toBe(assignee.id);
    expect(record!.status).toBe(NotificationTriggerStatus.SENT);
  });

  it("falls back to createdById when feature has no assignee", async () => {
    // Remove assignee
    await db.feature.update({
      where: { id: feature.id },
      data: { assigneeId: null },
    });

    await db.task.create({
      data: {
        title: "Task 1",
        workspaceId: workspace.id,
        featureId: feature.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: TaskStatus.DONE,
        workflowStatus: WorkflowStatus.COMPLETED,
      },
    });

    await updateFeatureStatusFromTasks(feature.id);
    await new Promise((r) => setTimeout(r, 200));

    const record = await db.notificationTrigger.findFirst({
      where: {
        notificationType: NotificationTriggerType.FEATURE_COMPLETED,
        featureId: feature.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.targetUserId).toBe(owner.id);
  });
});
