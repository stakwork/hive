import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/features/[featureId]/tickets/route";
import { DELETE } from "@/app/api/tickets/[ticketId]/route";
import { db } from "@/lib/db";
import { pusherServer } from "@/lib/pusher";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";
import {
  createAuthenticatedDeleteRequest,
} from "@/__tests__/support/helpers/request-builders";
import { expectSuccess } from "@/__tests__/support/helpers/api-assertions";
import type { User, Workspace, Feature } from "@prisma/client";

// Mock NextAuth (global mock already handles this but be explicit for clarity)
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock Pusher — we want to spy on trigger calls
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  getTaskChannelName: vi.fn((id: string) => `task-${id}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    FEATURE_UPDATED: "feature-updated",
    TASK_TITLE_UPDATE: "task-title-update",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
    DEPLOYMENT_STATUS_CHANGE: "deployment-status-change",
    PR_STATUS_CHANGE: "pr-status-change",
    FEATURE_TITLE_UPDATE: "feature-title-update",
  },
}));

describe("Pusher FEATURE_UPDATED broadcasts", () => {
  let owner: User;
  let workspace: Workspace;
  let feature: Feature;

  beforeEach(async () => {
    vi.clearAllMocks();

    owner = await createTestUser({ email: "owner-pusher@test.com" });
    workspace = await createTestWorkspace({
      name: "Pusher Test Workspace",
      slug: "pusher-test-workspace",
      ownerId: owner.id,
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: owner.id,
        role: "OWNER",
      },
    });

    feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: workspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });
  });

  describe("POST /api/features/[featureId]/tickets", () => {
    test("broadcasts FEATURE_UPDATED on the feature channel after ticket creation", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "New Task via Pusher Test" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectSuccess(response, 201);

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `feature-${feature.id}`,
        "feature-updated",
        expect.objectContaining({ featureId: feature.id })
      );
    });

    test("Pusher trigger receives a timestamp string", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Task With Timestamp" },
        owner
      );

      await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const triggerCalls = (pusherServer.trigger as ReturnType<typeof vi.fn>).mock.calls;
      const featureCall = triggerCalls.find((call) => call[0] === `feature-${feature.id}`);
      expect(featureCall).toBeDefined();
      expect(typeof featureCall![2].timestamp).toBe("string");
    });

    test("does not broadcast if feature does not exist (returns error without calling trigger)", async () => {
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/nonexistent-feature/tickets`,
        { title: "Task for missing feature" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: "nonexistent-feature" }),
      });

      expect(response.status).not.toBe(201);

      const featureTriggerCalls = (
        pusherServer.trigger as ReturnType<typeof vi.fn>
      ).mock.calls.filter((call) => call[0] === "feature-nonexistent-feature");
      expect(featureTriggerCalls).toHaveLength(0);
    });
  });

  describe("DELETE /api/tickets/[ticketId]", () => {
    test("broadcasts FEATURE_UPDATED on the feature channel after ticket deletion", async () => {
      // Create a task to delete
      const task = await db.task.create({
        data: {
          title: "Task to Delete",
          workspaceId: workspace.id,
          featureId: feature.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const ownerRef = { id: owner.id, email: owner.email!, name: owner.name! };
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${task.id}`,
        ownerRef
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ ticketId: task.id }),
      });

      await expectSuccess(response, 200);

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `feature-${feature.id}`,
        "feature-updated",
        expect.objectContaining({ featureId: feature.id })
      );
    });

    test("Pusher trigger for delete receives a timestamp string", async () => {
      const task = await db.task.create({
        data: {
          title: "Task to Delete with TS",
          workspaceId: workspace.id,
          featureId: feature.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const ownerRef = { id: owner.id, email: owner.email!, name: owner.name! };
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${task.id}`,
        ownerRef
      );

      await DELETE(request, { params: Promise.resolve({ ticketId: task.id }) });

      const triggerCalls = (pusherServer.trigger as ReturnType<typeof vi.fn>).mock.calls;
      const featureCall = triggerCalls.find((call) => call[0] === `feature-${feature.id}`);
      expect(featureCall).toBeDefined();
      expect(typeof featureCall![2].timestamp).toBe("string");
    });

    test("still deletes the task even if Pusher trigger throws", async () => {
      (pusherServer.trigger as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Pusher unavailable")
      );

      const task = await db.task.create({
        data: {
          title: "Task resilient to Pusher failure",
          workspaceId: workspace.id,
          featureId: feature.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const ownerRef = { id: owner.id, email: owner.email!, name: owner.name! };
      const request = createAuthenticatedDeleteRequest(
        `/api/tickets/${task.id}`,
        ownerRef
      );

      const response = await DELETE(request, { params: Promise.resolve({ ticketId: task.id }) });

      // Response should still be 200 — Pusher failure must not break the mutation
      await expectSuccess(response, 200);

      // Verify the task was actually soft-deleted in DB
      const taskAfter = await db.task.findUnique({ where: { id: task.id } });
      expect(taskAfter?.deleted).toBe(true);
    });

    test("still creates the task even if Pusher trigger throws during creation", async () => {
      (pusherServer.trigger as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Pusher unavailable")
      );

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/tickets`,
        { title: "Task resilient to Pusher on create" },
        owner
      );

      const response = await POST(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Should still succeed — Pusher failure must not break ticket creation
      await expectSuccess(response, 201);
    });
  });
});
