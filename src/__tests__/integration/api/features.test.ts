import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/features/route";
import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority } from "@prisma/client";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
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
        user
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
        user
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
      const request = createGetRequest(
        "http://localhost:3000/api/features?workspaceId=test-id"
      );

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
        nonMember
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
        user
      );

      const response = await GET(request);

      await expectError(response, "Invalid pagination parameters", 400);
    });

    describe("createdById filter", () => {
      test("filters features by creator", async () => {
        // Setup
        const creator1 = await createTestUser({ name: "Creator 1" });
        const creator2 = await createTestUser({ name: "Creator 2" });
        const workspace = await createTestWorkspace({
          ownerId: creator1.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        // Add creator2 as a member
        await db.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: creator2.id,
            role: "DEVELOPER",
          },
        });

        // Create features by different creators
        await db.feature.create({
          data: {
            title: "Feature by Creator 1",
            workspaceId: workspace.id,
            createdById: creator1.id,
            updatedById: creator1.id,
          },
        });

        await db.feature.create({
          data: {
            title: "Another Feature by Creator 1",
            workspaceId: workspace.id,
            createdById: creator1.id,
            updatedById: creator1.id,
          },
        });

        await db.feature.create({
          data: {
            title: "Feature by Creator 2",
            workspaceId: workspace.id,
            createdById: creator2.id,
            updatedById: creator2.id,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&createdById=${creator1.id}`,
          creator1
        );

        // Execute
        const response = await GET(request);

        // Assert
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(2);
        expect(data.pagination.totalCount).toBe(2);
        data.data.forEach((feature: any) => {
          expect(feature.createdBy.id).toBe(creator1.id);
        });
      });

      test("returns empty list when no features match creator", async () => {
        // Setup
        const creator = await createTestUser({ name: "Creator" });
        const otherUser = await createTestUser({ name: "Other User" });
        const workspace = await createTestWorkspace({
          ownerId: creator.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        // Create feature by creator
        await db.feature.create({
          data: {
            title: "Feature by Creator",
            workspaceId: workspace.id,
            createdById: creator.id,
            updatedById: creator.id,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&createdById=${otherUser.id}`,
          creator
        );

        // Execute
        const response = await GET(request);

        // Assert
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(0);
        expect(data.pagination.totalCount).toBe(0);
      });

      test("combines createdById with status filter", async () => {
        // Setup
        const creator = await createTestUser({ name: "Creator" });
        const workspace = await createTestWorkspace({
          ownerId: creator.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        // Create features with different statuses
        await db.feature.create({
          data: {
            title: "Backlog Feature",
            workspaceId: workspace.id,
            status: FeatureStatus.BACKLOG,
            createdById: creator.id,
            updatedById: creator.id,
          },
        });

        await db.feature.create({
          data: {
            title: "In Progress Feature",
            workspaceId: workspace.id,
            status: FeatureStatus.IN_PROGRESS,
            createdById: creator.id,
            updatedById: creator.id,
          },
        });

        await db.feature.create({
          data: {
            title: "Completed Feature",
            workspaceId: workspace.id,
            status: FeatureStatus.COMPLETED,
            createdById: creator.id,
            updatedById: creator.id,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&createdById=${creator.id}&status=${FeatureStatus.IN_PROGRESS}`,
          creator
        );

        // Execute
        const response = await GET(request);

        // Assert
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("In Progress Feature");
        expect(data.data[0].status).toBe(FeatureStatus.IN_PROGRESS);
      });

      test("combines createdById with priority filter", async () => {
        // Setup
        const creator = await createTestUser({ name: "Creator" });
        const workspace = await createTestWorkspace({
          ownerId: creator.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        // Create features with different priorities
        await db.feature.create({
          data: {
            title: "Low Priority Feature",
            workspaceId: workspace.id,
            priority: FeaturePriority.LOW,
            createdById: creator.id,
            updatedById: creator.id,
          },
        });

        await db.feature.create({
          data: {
            title: "High Priority Feature",
            workspaceId: workspace.id,
            priority: FeaturePriority.HIGH,
            createdById: creator.id,
            updatedById: creator.id,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&createdById=${creator.id}&priority=${FeaturePriority.HIGH}`,
          creator
        );

        // Execute
        const response = await GET(request);

        // Assert
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("High Priority Feature");
        expect(data.data[0].priority).toBe(FeaturePriority.HIGH);
      });

      test("combines createdById with assigneeId filter", async () => {
        // Setup
        const creator = await createTestUser({ name: "Creator" });
        const assignee = await createTestUser({ name: "Assignee" });
        const workspace = await createTestWorkspace({
          ownerId: creator.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        // Create features with different assignees
        await db.feature.create({
          data: {
            title: "Assigned Feature",
            workspaceId: workspace.id,
            createdById: creator.id,
            updatedById: creator.id,
            assigneeId: assignee.id,
          },
        });

        await db.feature.create({
          data: {
            title: "Unassigned Feature",
            workspaceId: workspace.id,
            createdById: creator.id,
            updatedById: creator.id,
            assigneeId: null,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&createdById=${creator.id}&assigneeId=${assignee.id}`,
          creator
        );

        // Execute
        const response = await GET(request);

        // Assert
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("Assigned Feature");
        expect(data.data[0].assignee.id).toBe(assignee.id);
      });

      test("works with pagination", async () => {
        // Setup
        const creator = await createTestUser({ name: "Creator" });
        const workspace = await createTestWorkspace({
          ownerId: creator.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        // Create 15 features by creator
        for (let i = 0; i < 15; i++) {
          await db.feature.create({
            data: {
              title: `Feature ${i + 1}`,
              workspaceId: workspace.id,
              createdById: creator.id,
              updatedById: creator.id,
            },
          });
        }

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&createdById=${creator.id}&page=2&limit=10`,
          creator
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

      test("returns all features when createdById not provided", async () => {
        // Setup
        const creator1 = await createTestUser({ name: "Creator 1" });
        const creator2 = await createTestUser({ name: "Creator 2" });
        const workspace = await createTestWorkspace({
          ownerId: creator1.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        // Add creator2 as a member
        await db.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: creator2.id,
            role: "DEVELOPER",
          },
        });

        // Create features by different creators
        await db.feature.create({
          data: {
            title: "Feature by Creator 1",
            workspaceId: workspace.id,
            createdById: creator1.id,
            updatedById: creator1.id,
          },
        });

        await db.feature.create({
          data: {
            title: "Feature by Creator 2",
            workspaceId: workspace.id,
            createdById: creator2.id,
            updatedById: creator2.id,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}`,
          creator1
        );

        // Execute
        const response = await GET(request);

        // Assert
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(2);
        expect(data.pagination.totalCount).toBe(2);
      });
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

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "New Feature",
        workspaceId: workspace.id,
        status: FeatureStatus.PLANNED,
        priority: FeaturePriority.HIGH,
      }, user);

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

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "Simple Feature",
        workspaceId: workspace.id,
      }, user);

      // Execute
      const response = await POST(request);

      // Assert
      const data = await expectSuccess(response, 201);
      expect(data.data).toMatchObject({
        title: "Simple Feature",
        status: FeatureStatus.BACKLOG, // default
        priority: FeaturePriority.LOW, // default
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

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "Assigned Feature",
        workspaceId: workspace.id,
        assigneeId: assignee.id,
      }, owner);

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

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        // Missing title and workspaceId
        status: FeatureStatus.BACKLOG,
      }, user);

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

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "New Feature",
        workspaceId: workspace.id,
        status: "INVALID_STATUS",
      }, user);

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

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "New Feature",
        workspaceId: workspace.id,
        priority: "INVALID_PRIORITY",
      }, user);

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

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "New Feature",
        workspaceId: workspace.id,
        assigneeId: "non-existent-user-id",
      }, user);

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

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "New Feature",
        workspaceId: workspace.id,
      }, nonMember);

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

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "  Trimmed Feature  ",
        workspaceId: workspace.id,
      }, user);

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Trimmed Feature");
    });
  });
});
