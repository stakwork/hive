import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, PATCH, DELETE } from "@/app/api/features/[featureId]/route";
import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority } from "@prisma/client";
import {
  createTestUser,
  createTestWorkspace,
  createTestFeature,
  createTestSwarm,
  createTestPod,
  resetDatabase,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createGetRequest,
  createPatchRequest,
  createAuthenticatedGetRequest,
  createAuthenticatedPatchRequest,
  createAuthenticatedDeleteRequest,
} from "@/__tests__/support/helpers";
import { releaseTaskPod } from "@/lib/pods/utils";

vi.mock("@/lib/pods/utils", async () => {
  const actual = await vi.importActual("@/lib/pods/utils");
  return { ...actual, releaseTaskPod: vi.fn() };
});

describe("Single Feature API - Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();
  });

  describe("GET /api/features/[featureId]", () => {
    test("returns feature with user stories for workspace member", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          status: FeatureStatus.IN_PROGRESS,
          priority: FeaturePriority.HIGH,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create user stories
      await db.userStory.create({
        data: {
          featureId: feature.id,
          title: "User Story 1",
          order: 1,
          completed: false,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      await db.userStory.create({
        data: {
          featureId: feature.id,
          title: "User Story 2",
          order: 2,
          completed: true,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        user
      );

      // Execute
      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data).toMatchObject({
        id: feature.id,
        title: "Test Feature",
        status: FeatureStatus.IN_PROGRESS,
        priority: FeaturePriority.HIGH,
      });
      expect(data.data.userStories).toHaveLength(2);
      expect(data.data.userStories[0].title).toBe("User Story 1");
      expect(data.data.userStories[0].order).toBe(1);
      expect(data.data.userStories[1].title).toBe("User Story 2");
      expect(data.data.userStories[1].completed).toBe(true);
    });

    test("includes workspace, assignee, and audit information", async () => {
      // Setup
      const creator = await createTestUser({ name: "Creator User" });
      const assignee = await createTestUser({ name: "Assignee User" });
      const workspace = await createTestWorkspace({
        ownerId: creator.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          assigneeId: assignee.id,
          createdById: creator.id,
          updatedById: creator.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        creator
      );

      // Execute
      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data.workspace).toMatchObject({
        id: workspace.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });
      expect(data.data.assignee).toMatchObject({
        id: assignee.id,
        name: "Assignee User",
      });
      expect(data.data.createdBy).toMatchObject({
        id: creator.id,
        name: "Creator User",
      });
    });

    test("returns 404 for unauthenticated requests on non-public workspaces", async () => {
      // The GET handler resolves access via `resolveWorkspaceAccess`, which
      // returns a unified 404 whenever the caller isn't a member and the
      // workspace isn't flagged `isPublicViewable`. We never distinguish
      // "feature not found" from "not allowed" at this layer.
      const request = createGetRequest(
        "http://localhost:3000/api/features/test-feature-id"
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: "test-feature-id" }),
      });

      await expectError(response, "Feature not found", 404);
    });

    test("returns 404 for non-existent feature", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/features/non-existent-id",
        user
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: "non-existent-id" }),
      });

      await expectError(response, "Feature not found", 404);
    });

    test("denies access to non-workspace members", async () => {
      // Setup
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        nonMember
      );

      // Execute
      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert: non-members on a non-public workspace get a unified 404
      // from `resolveWorkspaceAccess`, not 403 "Access denied".
      await expectError(response, "Workspace not found or access denied", 404);
    });
  });

  describe("PATCH /api/features/[featureId]", () => {
    test("updates feature title", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Original Title",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { title: "Updated Title" },
        user
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data.title).toBe("Updated Title");
      expect(data.data.updatedById).toBe(user.id);
    });

    test("updates feature status", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          status: FeatureStatus.BACKLOG,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { status: FeatureStatus.IN_PROGRESS },
        user
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data.status).toBe(FeatureStatus.IN_PROGRESS);
    });

    test("updates feature priority", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          priority: FeaturePriority.LOW,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { priority: FeaturePriority.CRITICAL },
        user
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data.priority).toBe(FeaturePriority.CRITICAL);
    });

    test("updates feature assignee", async () => {
      // Setup
      const owner = await createTestUser();
      const assignee = await createTestUser({ name: "New Assignee" });
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { assigneeId: assignee.id },
        owner
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data.assignee).toMatchObject({
        id: assignee.id,
        name: "New Assignee",
      });
    });

    test("can unassign feature by setting assigneeId to null", async () => {
      // Setup
      const owner = await createTestUser();
      const assignee = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          assigneeId: assignee.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { assigneeId: null },
        owner
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data.assigneeId).toBeNull();
      expect(data.data.assignee).toBeNull();
    });

    test("updates multiple fields at once", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Original Title",
          workspaceId: workspace.id,
          status: FeatureStatus.BACKLOG,
          priority: FeaturePriority.LOW,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        {
          title: "New Title",
          status: FeatureStatus.COMPLETED,
          priority: FeaturePriority.HIGH,
        },
        user
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data).toMatchObject({
        title: "New Title",
        status: FeatureStatus.COMPLETED,
        priority: FeaturePriority.HIGH,
      });
    });

    test("trims whitespace from title", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Original Title",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { title: "  Trimmed Title  " },
        user
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data.title).toBe("Trimmed Title");
    });

    test("requires authentication", async () => {
      const request = createPatchRequest(
        "http://localhost:3000/api/features/test-feature-id",
        { title: "New Title" }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: "test-feature-id" }),
      });

      await expectUnauthorized(response);
    });

    test("returns 404 for non-existent feature", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPatchRequest(
        "http://localhost:3000/api/features/non-existent-id",
        { title: "New Title" },
        user
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: "non-existent-id" }),
      });

      await expectError(response, "Feature not found", 404);
    });

    test("denies access to non-workspace members", async () => {
      // Setup
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { title: "Updated Title" },
        nonMember
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      await expectError(response, "Access denied", 403);
    });

    test("validates status enum", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { status: "INVALID_STATUS" },
        user
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      await expectError(response, "Invalid status", 400);
    });

    test("validates priority enum", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { priority: "INVALID_PRIORITY" },
        user
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      await expectError(response, "Invalid priority", 400);
    });

    test("validates assignee exists", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { assigneeId: "non-existent-user-id" },
        user
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      await expectError(response, "Assignee not found", 400);
    });
  });

  describe("DELETE /api/features/[featureId]", () => {
    test("releases pods for tasks that have one before soft-deleting the feature", async () => {
      const releaseTaskPodMock = vi.mocked(releaseTaskPod);
      releaseTaskPodMock.mockResolvedValue(undefined as any);

      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const swarm = await createTestSwarm({ workspaceId: workspace.id });
      const pod = await createTestPod({ swarmId: swarm.id });
      const feature = await createTestFeature({
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
      });

      // Task with a pod assigned
      const taskWithPod = await db.task.create({
        data: {
          title: "Task with pod",
          description: "Has pod",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          featureId: feature.id,
          podId: pod.podId,
        },
      });

      // Task without a pod
      await db.task.create({
        data: {
          title: "Task without pod",
          description: "No pod",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          featureId: feature.id,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        user
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);
      expect(releaseTaskPodMock).toHaveBeenCalledTimes(1);
      expect(releaseTaskPodMock).toHaveBeenCalledWith({
        taskId: taskWithPod.id,
        podId: pod.podId,
        workspaceId: workspace.id,
        verifyOwnership: true,
        clearTaskFields: true,
        newWorkflowStatus: null,
      });
    });

    test("pod release failure does not block feature soft-delete", async () => {
      const releaseTaskPodMock = vi.mocked(releaseTaskPod);
      releaseTaskPodMock.mockRejectedValue(new Error("release failed"));

      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const swarm = await createTestSwarm({ workspaceId: workspace.id });
      const pod = await createTestPod({ swarmId: swarm.id });
      const feature = await createTestFeature({
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
      });

      await db.task.create({
        data: {
          title: "Task with pod",
          description: "Has pod",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          featureId: feature.id,
          podId: pod.podId,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        user
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);
      const deleted = await db.feature.findUnique({ where: { id: feature.id } });
      expect(deleted?.deleted).toBe(true);
    });

    test("feature with no pod tasks deletes cleanly without calling releaseTaskPod", async () => {
      const releaseTaskPodMock = vi.mocked(releaseTaskPod);

      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const feature = await createTestFeature({
        workspaceId: workspace.id,
        createdById: user.id,
        updatedById: user.id,
      });

      const request = createAuthenticatedDeleteRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        user
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      expect(response.status).toBe(200);
      expect(releaseTaskPodMock).not.toHaveBeenCalled();
      const deleted = await db.feature.findUnique({ where: { id: feature.id } });
      expect(deleted?.deleted).toBe(true);
    });
  });
});
