import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, PATCH } from "@/app/api/features/[featureId]/route";
import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority } from "@prisma/client";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  createGetRequest,
  createPatchRequest,
} from "@/__tests__/support/helpers";

describe("Single Feature API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        `http://localhost:3000/api/features/${feature.id}`
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(creator));

      const request = createGetRequest(
        `http://localhost:3000/api/features/${feature.id}`
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

    test("requires authentication", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost:3000/api/features/test-feature-id"
      );

      const response = await GET(request, {
        params: Promise.resolve({ featureId: "test-feature-id" }),
      });

      await expectUnauthorized(response);
    });

    test("returns 404 for non-existent feature", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/features/non-existent-id"
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createGetRequest(
        `http://localhost:3000/api/features/${feature.id}`
      );

      // Execute
      const response = await GET(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      await expectError(response, "Access denied", 403);
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { title: "Updated Title" }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { status: FeatureStatus.IN_PROGRESS }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { priority: FeaturePriority.URGENT }
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data.priority).toBe(FeaturePriority.URGENT);
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { assigneeId: assignee.id }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { assigneeId: null }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        {
          title: "New Title",
          status: FeatureStatus.COMPLETED,
          priority: FeaturePriority.HIGH,
        }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { title: "  Trimmed Title  " }
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
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

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
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        "http://localhost:3000/api/features/non-existent-id",
        { title: "New Title" }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { title: "Updated Title" }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { status: "INVALID_STATUS" }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { priority: "INVALID_PRIORITY" }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { assigneeId: "non-existent-user-id" }
      );

      // Execute
      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Assert
      await expectError(response, "Assignee not found", 400);
    });
  });
});
