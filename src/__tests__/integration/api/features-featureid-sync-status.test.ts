import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/sync-status/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedPostRequest,
  expectSuccess,
  expectUnauthorized,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { FeatureStatus, Priority, TaskStatus, WorkflowStatus } from "@prisma/client";
import type { User, Workspace, Feature } from "@prisma/client";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock Pusher
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((id: string) => `task-${id}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  PUSHER_EVENTS: {
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
    FEATURE_UPDATED: "feature-updated",
  },
}));

// Mock notifications
vi.mock("@/services/notifications", () => ({
  createAndSendNotification: vi.fn().mockResolvedValue({}),
}));

describe("POST /api/features/[featureId]/sync-status", () => {
  let owner: User;
  let outsider: User;
  let workspace: Workspace;
  let feature: Feature;

  beforeEach(async () => {
    await resetDatabase();

    owner = await createTestUser({ name: "Owner" });
    outsider = await createTestUser({ name: "Outsider" });

    workspace = await createTestWorkspace({ ownerId: owner.id });

    feature = await db.feature.create({
      data: {
        title: `Test Feature ${generateUniqueId()}`,
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
        status: FeatureStatus.IN_PROGRESS,
        priority: Priority.MEDIUM,
      },
    });
  });

  it("should return 401 for unauthenticated requests", async () => {
    const request = new Request(
      `http://localhost/api/features/${feature.id}/sync-status`,
      { method: "POST" }
    );

    const response = await POST(request as any, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    await expectUnauthorized(response);
    expect(response.status).toBe(401);
  });

  it("should return 403 for non-member users", async () => {
    const request = createAuthenticatedPostRequest(
      `/api/features/${feature.id}/sync-status`,
      outsider,
      {}
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    expect(response.status).toBe(403);
  });

  it("should return 200 and not change status when feature has no tasks", async () => {
    const request = createAuthenticatedPostRequest(
      `/api/features/${feature.id}/sync-status`,
      owner,
      {}
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    const result = await expectSuccess(response, 200);
    expect(result.success).toBe(true);

    // Status should remain unchanged
    const updated = await db.feature.findUnique({ where: { id: feature.id } });
    expect(updated?.status).toBe(FeatureStatus.IN_PROGRESS);
  });

  it("should update feature status to COMPLETED when all tasks are DONE with COMPLETED workflow", async () => {
    const phase = await db.phase.create({
      data: {
        name: "Phase 1",
        featureId: feature.id,
        order: 0,
      },
    });

    // Create two tasks, both DONE + COMPLETED
    await db.task.createMany({
      data: [
        {
          title: "Task 1",
          workspaceId: workspace.id,
          featureId: feature.id,
          phaseId: phase.id,
          status: TaskStatus.DONE,
          workflowStatus: WorkflowStatus.COMPLETED,
          priority: Priority.MEDIUM,
          createdById: owner.id,
          updatedById: owner.id,
        },
        {
          title: "Task 2",
          workspaceId: workspace.id,
          featureId: feature.id,
          phaseId: phase.id,
          status: TaskStatus.DONE,
          workflowStatus: WorkflowStatus.COMPLETED,
          priority: Priority.MEDIUM,
          createdById: owner.id,
          updatedById: owner.id,
        },
      ],
    });

    const request = createAuthenticatedPostRequest(
      `/api/features/${feature.id}/sync-status`,
      owner,
      {}
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    const result = await expectSuccess(response, 200);
    expect(result.success).toBe(true);

    const updated = await db.feature.findUnique({ where: { id: feature.id } });
    expect(updated?.status).toBe(FeatureStatus.COMPLETED);
  });

  it("should keep status as IN_PROGRESS when tasks have mixed statuses", async () => {
    const phase = await db.phase.create({
      data: {
        name: "Phase 1",
        featureId: feature.id,
        order: 0,
      },
    });

    await db.task.createMany({
      data: [
        {
          title: "Task Done",
          workspaceId: workspace.id,
          featureId: feature.id,
          phaseId: phase.id,
          status: TaskStatus.DONE,
          workflowStatus: WorkflowStatus.COMPLETED,
          priority: Priority.MEDIUM,
          createdById: owner.id,
          updatedById: owner.id,
        },
        {
          title: "Task In Progress",
          workspaceId: workspace.id,
          featureId: feature.id,
          phaseId: phase.id,
          status: TaskStatus.IN_PROGRESS,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          priority: Priority.MEDIUM,
          createdById: owner.id,
          updatedById: owner.id,
        },
      ],
    });

    const request = createAuthenticatedPostRequest(
      `/api/features/${feature.id}/sync-status`,
      owner,
      {}
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    const result = await expectSuccess(response, 200);
    expect(result.success).toBe(true);

    const updated = await db.feature.findUnique({ where: { id: feature.id } });
    expect(updated?.status).toBe(FeatureStatus.IN_PROGRESS);
  });

  it("should allow workspace members (non-owner) to trigger sync", async () => {
    const member = await createTestUser({ name: "Member" });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: member.id,
      role: "DEVELOPER",
    });

    const request = createAuthenticatedPostRequest(
      `/api/features/${feature.id}/sync-status`,
      member,
      {}
    );

    const response = await POST(request, {
      params: Promise.resolve({ featureId: feature.id }),
    });

    const result = await expectSuccess(response, 200);
    expect(result.success).toBe(true);
  });
});
