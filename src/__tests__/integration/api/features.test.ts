import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/features/route";
import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority, ChatRole, ChatStatus } from "@prisma/client";
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
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create test features
      await db.features.create({
        data: {
          title: "Feature 1",workspace_id: workspace.id,
          status: FeatureStatus.BACKLOG,
          priority: FeaturePriority.HIGH,created_by_id: user.id,updated_by_id: user.id,
        },
      });

      await db.features.create({
        data: {
          title: "Feature 2",workspace_id: workspace.id,
          status: FeatureStatus.IN_PROGRESS,
          priority: FeaturePriority.MEDIUM,created_by_id: user.id,updated_by_id: user.id,
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
      const expectedFeaturesCount = 2; // Based on features created above
      expect(data.data).toHaveLength(expectedFeaturesCount);
      expect(data.pagination).toMatchObject({
        page: 1,
        limit: 10,
        totalCount: expectedFeaturesCount,
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
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create 15 features
      for (let i = 0; i < 15; i++) {
        await db.features.create({
          data: {
            title: `Feature ${i + 1}`,workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
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
      const workspace = await createTestWorkspace({owner_id: owner.id,
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
      const workspace = await createTestWorkspace({owner_id: user.id,
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

    describe("Owner (assigneeId) filter — OR logic", () => {
      test("returns features where user is the explicit assignee", async () => {
        const owner = await createTestUser({ name: "Workspace Owner" });
        const assignee = await createTestUser({ name: "Assigned User" });
        const workspace = await createTestWorkspace({owner_id: owner.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        // Feature explicitly assigned to assignee
        await db.features.create({
          data: {
            title: "Assigned Feature",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: assignee.id,
          },
        });

        // Feature with no assignee, different creator — should NOT appear
        await db.features.create({
          data: {
            title: "Unassigned Feature by Owner",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: null,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&assigneeId=${assignee.id}`,
          owner
        );

        const response = await GET(request);
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("Assigned Feature");
        expect(data.data[0].assignee.id).toBe(assignee.id);
      });

      test("returns features where user is creator and no assignee is set", async () => {
        const owner = await createTestUser({ name: "Workspace Owner" });
        const otherUser = await createTestUser({ name: "Other User" });
        const workspace = await createTestWorkspace({owner_id: owner.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });
        await db.workspace_members.create({
          data: {workspace_id: workspace.id,user_id: otherUser.id, role: "DEVELOPER" },
        });

        // Feature created by owner, no assignee — should appear when filtering by owner
        await db.features.create({
          data: {
            title: "Created by Owner, no Assignee",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: null,
          },
        });

        // Feature created by otherUser, no assignee — should NOT appear
        await db.features.create({
          data: {
            title: "Created by Other, no Assignee",workspace_id: workspace.id,created_by_id: otherUser.id,updated_by_id: otherUser.id,assignee_id: null,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&assigneeId=${owner.id}`,
          owner
        );

        const response = await GET(request);
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("Created by Owner, no Assignee");
      });

      test("returns both assignee features and creator-only features for the same user", async () => {
        const owner = await createTestUser({ name: "Workspace Owner" });
        const workspace = await createTestWorkspace({owner_id: owner.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        // Feature where owner is the explicit assignee
        await db.features.create({
          data: {
            title: "Owner is Assignee",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: owner.id,
          },
        });

        // Feature where owner is creator with no assignee
        await db.features.create({
          data: {
            title: "Owner is Creator, no Assignee",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: null,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&assigneeId=${owner.id}`,
          owner
        );

        const response = await GET(request);
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(2);
        expect(data.pagination.totalCount).toBe(2);
        const titles = data.data.map((f: any) => f.title);
        expect(titles).toContain("Owner is Assignee");
        expect(titles).toContain("Owner is Creator, no Assignee");
      });

      test("UNASSIGNED returns only features with no assignee (regardless of creator)", async () => {
        const owner = await createTestUser({ name: "Workspace Owner" });
        const assignee = await createTestUser({ name: "Assignee" });
        const workspace = await createTestWorkspace({owner_id: owner.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        await db.features.create({
          data: {
            title: "Has Assignee",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: assignee.id,
          },
        });

        await db.features.create({
          data: {
            title: "No Assignee",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: null,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&assigneeId=UNASSIGNED`,
          owner
        );

        const response = await GET(request);
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("No Assignee");
        expect(data.data[0].assignee).toBeNull();
      });

      test("returns all features when assigneeId is not provided", async () => {
        const owner = await createTestUser({ name: "Workspace Owner" });
        const assignee = await createTestUser({ name: "Assigned User" });
        const workspace = await createTestWorkspace({owner_id: owner.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        await db.features.create({
          data: {
            title: "Assigned Feature",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: assignee.id,
          },
        });

        await db.features.create({
          data: {
            title: "Unassigned Feature",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: null,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}`,
          owner
        );

        const response = await GET(request);
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(2);
        expect(data.pagination.totalCount).toBe(2);
      });

      test("owner filter combines correctly with status filter", async () => {
        const owner = await createTestUser({ name: "Workspace Owner" });
        const workspace = await createTestWorkspace({owner_id: owner.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        // Creator-only feature (BACKLOG)
        await db.features.create({
          data: {
            title: "Creator Backlog Feature",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: null,
            status: FeatureStatus.BACKLOG,
          },
        });

        // Creator-only feature (IN_PROGRESS) — should appear
        await db.features.create({
          data: {
            title: "Creator In Progress Feature",workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: null,
            status: FeatureStatus.IN_PROGRESS,
          },
        });

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&assigneeId=${owner.id}&status=${FeatureStatus.IN_PROGRESS}`,
          owner
        );

        const response = await GET(request);
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(1);
        expect(data.data[0].title).toBe("Creator In Progress Feature");
      });

      test("pagination is correct with OR owner filter", async () => {
        const owner = await createTestUser({ name: "Workspace Owner" });
        const workspace = await createTestWorkspace({owner_id: owner.id,
          name: "Test Workspace",
          slug: "test-workspace",
        });

        // Create 12 features owned by owner (mix of assignee and creator-only)
        for (let i = 0; i < 6; i++) {
          await db.features.create({
            data: {
              title: `Assigned Feature ${i + 1}`,workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: owner.id,
            },
          });
        }
        for (let i = 0; i < 6; i++) {
          await db.features.create({
            data: {
              title: `Creator Feature ${i + 1}`,workspace_id: workspace.id,created_by_id: owner.id,updated_by_id: owner.id,assignee_id: null,
            },
          });
        }

        const request = createAuthenticatedGetRequest(
          `http://localhost:3000/api/features?workspaceId=${workspace.id}&assigneeId=${owner.id}&page=2&limit=10`,
          owner
        );

        const response = await GET(request);
        const data = await expectSuccess(response, 200);
        expect(data.data).toHaveLength(2);
        expect(data.pagination).toMatchObject({
          page: 2,
          limit: 10,
          totalCount: 12,
          totalPages: 2,
          hasMore: false,
        });
      });
    });
  });

  describe("POST /api/features", () => {
    test("creates feature successfully", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "New Feature",workspace_id: workspace.id,
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
        priority: FeaturePriority.HIGH,created_by_id: user.id,updated_by_id: user.id,
      });
    });

    test("uses default values for optional fields", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "Simple Feature",workspace_id: workspace.id,
      }, user);

      // Execute
      const response = await POST(request);

      // Assert
      const data = await expectSuccess(response, 201);
      expect(data.data).toMatchObject({
        title: "Simple Feature",
        status: FeatureStatus.BACKLOG, // default
        priority: FeaturePriority.LOW, // default
assignee_id: null,
      });
    });

    test("assigns feature to user", async () => {
      // Setup
      const owner = await createTestUser();
      const assignee = await createTestUser({ name: "Assignee User" });
      const workspace = await createTestWorkspace({owner_id: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "Assigned Feature",workspace_id: workspace.id,assignee_id: assignee.id,
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
        title: "New Feature",workspace_id: "test-id",
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
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "New Feature",workspace_id: workspace.id,
        status: "INVALID_STATUS",
      }, user);

      const response = await POST(request);

      await expectError(response, "Invalid status", 400);
    });

    test("validates priority enum", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "New Feature",workspace_id: workspace.id,
        priority: "INVALID_PRIORITY",
      }, user);

      const response = await POST(request);

      await expectError(response, "Invalid priority", 400);
    });

    test("validates assignee exists", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "New Feature",workspace_id: workspace.id,assignee_id: "non-existent-user-id",
      }, user);

      const response = await POST(request);

      await expectError(response, "Assignee not found", 400);
    });

    test("denies access to non-workspace members", async () => {
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "New Feature",workspace_id: workspace.id,
      }, nonMember);

      const response = await POST(request);

      await expectError(response, "Access denied", 403);
    });

    test("trims whitespace from title", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "  Trimmed Feature  ",workspace_id: workspace.id,
      }, user);

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Trimmed Feature");
    });

    test("creates feature with isFastTrack: true", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "Fast Track Feature",workspace_id: workspace.id,is_fast_track: true,
      }, user);

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.data.isFastTrack).toBe(true);

      // Verify in database
      const feature = await db.features.findUnique({
        where: { id: data.data.id },
        select: {is_fast_track: true },
      });
      expect(feature?.isFastTrack).toBe(true);
    });

    test("defaults isFastTrack to false when omitted", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "Regular Feature",workspace_id: workspace.id,
      }, user);

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.data.isFastTrack).toBe(false);

      // Verify in database
      const feature = await db.features.findUnique({
        where: { id: data.data.id },
        select: {is_fast_track: true },
      });
      expect(feature?.isFastTrack).toBe(false);
    });

    test("creates feature with isFastTrack: false explicitly", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const request = createAuthenticatedPostRequest("http://localhost:3000/api/features", {
        title: "Explicit Non-Fast-Track Feature",workspace_id: workspace.id,is_fast_track: false,
      }, user);

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.data.isFastTrack).toBe(false);

      // Verify in database
      const feature = await db.features.findUnique({
        where: { id: data.data.id },
        select: {is_fast_track: true },
      });
      expect(feature?.isFastTrack).toBe(false);
    });
  });

  describe("GET /api/features - needsAttention filter", () => {
    test("returns feature with ASSISTANT last message and no tasks when needsAttention=true", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Feature that SHOULD appear: last message = ASSISTANT, no tasks
      const awaitingFeature = await db.features.create({
        data: {
          title: "Awaiting Feedback Feature",workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
        },
      });
      await db.chat_messages.create({
        data: {feature_id: awaitingFeature.id,
          role: ChatRole.ASSISTANT,
          message: "I've analyzed the requirements. Could you clarify your goals?",
          status: ChatStatus.SENT,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features?workspaceId=${workspace.id}&needsAttention=true`,
        user
      );
      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe(awaitingFeature.id);
      expect(data.data[0].awaitingFeedback).toBe(true);
    });

    test("excludes feature where last message is USER when needsAttention=true", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Feature that should NOT appear: last message is USER
      const repliedFeature = await db.features.create({
        data: {
          title: "User Replied Feature",workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
        },
      });
      await db.chat_messages.create({
        data: {feature_id: repliedFeature.id,
          role: ChatRole.ASSISTANT,
          message: "What are your requirements?",
          status: ChatStatus.SENT,
        },
      });
      await db.chat_messages.create({
        data: {feature_id: repliedFeature.id,
          role: ChatRole.USER,
          message: "Here they are...",
          status: ChatStatus.SENT,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features?workspaceId=${workspace.id}&needsAttention=true`,
        user
      );
      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      expect(data.data).toHaveLength(0);
    });

    test("excludes feature with ASSISTANT last message but with tasks when needsAttention=true", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Feature that should NOT appear: has tasks
      const featureWithTasks = await db.features.create({
        data: {
          title: "Feature With Tasks",workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
        },
      });
      await db.chat_messages.create({
        data: {feature_id: featureWithTasks.id,
          role: ChatRole.ASSISTANT,
          message: "Tasks have been generated!",
          status: ChatStatus.SENT,
        },
      });
      // Create a task for the feature directly (no phase)
      await db.tasks.create({
        data: {
          title: "Some Task",workspace_id: workspace.id,feature_id: featureWithTasks.id,created_by_id: user.id,updated_by_id: user.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features?workspaceId=${workspace.id}&needsAttention=true`,
        user
      );
      const response = await GET(request);
      const data = await expectSuccess(response, 200);

      expect(data.data).toHaveLength(0);
    });
  });
});
