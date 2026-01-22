import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, PATCH } from "@/app/api/features/[featureId]/route";
import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority } from "@prisma/client";
import { COMMON_PERSONAS } from "@/lib/constants/personas";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createGetRequest,
  createPatchRequest,
  createAuthenticatedGetRequest,
  createAuthenticatedPatchRequest,
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

    test("requires authentication", async () => {
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

    test("accepts valid COMMON_PERSONAS", async () => {
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
          personas: [],
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { personas: ["End User", "Admin"] },
        user
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data.personas).toEqual(["End User", "Admin"]);
    });

    test("rejects invalid persona", async () => {
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
          personas: [],
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { personas: ["Invalid Persona"] },
        user
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(
        response,
        `Invalid persona(s). Allowed values: ${COMMON_PERSONAS.join(", ")}`,
        400
      );
    });

    test("rejects mixed valid and invalid personas", async () => {
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
          personas: [],
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { personas: ["End User", "Invalid Persona", "Admin"] },
        user
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(
        response,
        `Invalid persona(s). Allowed values: ${COMMON_PERSONAS.join(", ")}`,
        400
      );
    });

    test("accepts empty personas array", async () => {
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
          personas: ["End User"],
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/features/${feature.id}`,
        { personas: [] },
        user
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data.personas).toEqual([]);
    });
  });
});
