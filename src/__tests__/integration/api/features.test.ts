import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/features/route";
import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority } from "@prisma/client";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createGetRequest,
  createPostRequest,
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";

describe("Features API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/features", () => {
    test("returns features for workspace with access", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create test features
      await db.feature.create({
        data: {
          title: "Feature 1",
          workspaceId: workspace.id,
          status: FeatureStatus.BACKLOG,
          priority: FeaturePriority.HIGH,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      await db.feature.create({
        data: {
          title: "Feature 2",
          workspaceId: workspace.id,
          status: FeatureStatus.IN_PROGRESS,
          priority: FeaturePriority.MEDIUM,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features?workspaceId=${workspace.id}`,
        user,
      );

      // Execute
      const response = await GET(request);

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data).toHaveLength(2);
      expect(data.pagination).toMatchObject({
        page: 1,
        limit: 10,
        totalCount: 2,
        totalPages: 1,
        hasMore: false,
      });
      expect(data.data[0]).toMatchObject({
        title: "Feature 2", // Most recent first
        status: FeatureStatus.IN_PROGRESS,
        priority: FeaturePriority.MEDIUM,
      });
    });

    test("supports pagination", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create 15 features
      for (let i = 0; i < 15; i++) {
        await db.feature.create({
          data: {
            title: `Feature ${i + 1}`,
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
          },
        });
      }

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features?workspaceId=${workspace.id}&page=2&limit=10`,
        user,
      );

      // Execute
      const response = await GET(request);

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data).toHaveLength(5); // 5 remaining on page 2
      expect(data.pagination).toMatchObject({
        page: 2,
        limit: 10,
        totalCount: 15,
        totalPages: 2,
        hasMore: false,
      });
    });

    test("requires authentication", async () => {
      const request = createGetRequest("http://localhost:3000/api/features?workspaceId=test-id");

      const response = await GET(request);

      await expectUnauthorized(response);
    });

    test("requires workspaceId parameter", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedGetRequest("http://localhost:3000/api/features", user);

      const response = await GET(request);

      await expectError(response, "workspaceId query parameter is required", 400);
    });

    test("denies access to workspace non-members", async () => {
      // Setup
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features?workspaceId=${workspace.id}`,
        nonMember,
      );

      // Execute
      const response = await GET(request);

      // Assert
      await expectError(response, "Access denied", 403);
    });

    test("validates pagination parameters", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features?workspaceId=${workspace.id}&page=0&limit=200`,
        user,
      );

      const response = await GET(request);

      await expectError(response, "Invalid pagination parameters", 400);
    });
  });

  describe("POST /api/features", () => {
    test("creates feature successfully", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features",
        {
          title: "New Feature",
          workspaceId: workspace.id,
          status: FeatureStatus.PLANNED,
          priority: FeaturePriority.HIGH,
        },
        user,
      );

      // Execute
      const response = await POST(request);

      // Assert
      const data = await expectSuccess(response, 201);
      expect(data.data).toMatchObject({
        title: "New Feature",
        status: FeatureStatus.PLANNED,
        priority: FeaturePriority.HIGH,
        createdById: user.id,
        updatedById: user.id,
      });
    });

    test("uses default values for optional fields", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features",
        {
          title: "Simple Feature",
          workspaceId: workspace.id,
        },
        user,
      );

      // Execute
      const response = await POST(request);

      // Assert
      const data = await expectSuccess(response, 201);
      expect(data.data).toMatchObject({
        title: "Simple Feature",
        status: FeatureStatus.BACKLOG, // default
        priority: FeaturePriority.NONE, // default
        assigneeId: null,
      });
    });

    test("assigns feature to user", async () => {
      // Setup
      const owner = await createTestUser();
      const assignee = await createTestUser({ name: "Assignee User" });
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features",
        {
          title: "Assigned Feature",
          workspaceId: workspace.id,
          assigneeId: assignee.id,
        },
        owner,
      );

      // Execute
      const response = await POST(request);

      // Assert
      const data = await expectSuccess(response, 201);
      expect(data.data.assignee).toMatchObject({
        id: assignee.id,
        name: "Assignee User",
      });
    });

    test("requires authentication", async () => {
      const request = createPostRequest("http://localhost:3000/api/features", {
        title: "New Feature",
        workspaceId: "test-id",
      });

      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("validates required fields", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features",
        {
          // Missing title and workspaceId
          status: FeatureStatus.BACKLOG,
        },
        user,
      );

      const response = await POST(request);

      await expectError(response, "Missing required fields", 400);
    });

    test("validates status enum", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features",
        {
          title: "New Feature",
          workspaceId: workspace.id,
          status: "INVALID_STATUS",
        },
        user,
      );

      const response = await POST(request);

      await expectError(response, "Invalid status", 400);
    });

    test("validates priority enum", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features",
        {
          title: "New Feature",
          workspaceId: workspace.id,
          priority: "INVALID_PRIORITY",
        },
        user,
      );

      const response = await POST(request);

      await expectError(response, "Invalid priority", 400);
    });

    test("validates assignee exists", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features",
        {
          title: "New Feature",
          workspaceId: workspace.id,
          assigneeId: "non-existent-user-id",
        },
        user,
      );

      const response = await POST(request);

      await expectError(response, "Assignee not found", 400);
    });

    test("denies access to non-workspace members", async () => {
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features",
        {
          title: "New Feature",
          workspaceId: workspace.id,
        },
        nonMember,
      );

      const response = await POST(request);

      await expectError(response, "Access denied", 403);
    });

    test("trims whitespace from title", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features",
        {
          title: "  Trimmed Feature  ",
          workspaceId: workspace.id,
        },
        user,
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Trimmed Feature");
    });
  });
});
