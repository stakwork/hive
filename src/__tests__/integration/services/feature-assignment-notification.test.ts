/**
 * Integration test: FEATURE_ASSIGNED notification trigger
 *
 * Calls updateFeature() with a new assigneeId and verifies a notification_triggers
 * row is created with type FEATURE_ASSIGNED and correct targetUserId.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { updateFeature } from "@/services/roadmap/features";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { NotificationTriggerType, NotificationTriggerStatus } from "@prisma/client";

// Mock Sphinx delivery so no real HTTP calls are made
vi.mock("@/lib/sphinx/direct-message", () => ({
  sendDirectMessage: vi.fn().mockResolvedValue({ success: true }),
  isDirectMessageConfigured: vi.fn().mockReturnValue(true),
}));

// Mock pusher so it doesn't fail in test env
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

describe("FEATURE_ASSIGNED notification", () => {
  let owner: { id: string };
  let assignee: { id: string };
  let workspace: { id: string; slug: string };
  let feature: { id: string };

  beforeEach(async () => {
    await resetDatabase();

    owner = await db.user.create({
      data: { email: "owner@test.com", name: "Owner" },
    });
    assignee = await db.user.create({
      data: { email: "assignee@test.com", name: "Assignee", lightningPubkey: "test-pubkey-assignee" },
    });

    const { createTestWorkspace } = await import("@/__tests__/support/factories/workspace.factory");
    workspace = await createTestWorkspace({
      ownerId: owner.id,
      name: "Test Workspace",
      slug: "test-ws-feat-assign",
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
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("creates a FEATURE_ASSIGNED notification_trigger row when assigning to another user", async () => {
    await updateFeature(feature.id, owner.id, { assigneeId: assignee.id });

    // Give async fire-and-forget time to settle (CI can be slow)
    await new Promise((r) => setTimeout(r, 500));

    const record = await db.notificationTrigger.findFirst({
      where: {
        targetUserId: assignee.id,
        notificationType: NotificationTriggerType.FEATURE_ASSIGNED,
        featureId: feature.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.targetUserId).toBe(assignee.id);
    expect(record!.status).toBe(NotificationTriggerStatus.SENT);
  });

  it("does NOT create a notification when self-assigning", async () => {
    await updateFeature(feature.id, owner.id, { assigneeId: owner.id });

    await new Promise((r) => setTimeout(r, 500));

    const records = await db.notificationTrigger.findMany({
      where: { notificationType: NotificationTriggerType.FEATURE_ASSIGNED },
    });

    expect(records).toHaveLength(0);
  });
});
