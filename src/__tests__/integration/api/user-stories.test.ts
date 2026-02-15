import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/features/[featureId]/user-stories/route";
import { POST as POST_REORDER } from "@/app/api/features/[featureId]/user-stories/reorder/route";
import { PATCH, DELETE } from "@/app/api/user-stories/[storyId]/route";
import { db } from "@/lib/db";
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
  createPatchRequest,
  createDeleteRequest,
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createAuthenticatedPatchRequest,
  createAuthenticatedDeleteRequest,
} from "@/__tests__/support/helpers";

describe("User Stories API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/features/[featureId]/user-stories", () => {
    test("returns user stories ordered by order field", async () => {
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

      await db.userStory.createMany({
        data: [
          {
            title: "Story 3",
            featureId: feature.id,
            order: 2,
            createdById: user.id,
            updatedById: user.id,
          },
          {
            title: "Story 1",
            featureId: feature.id,
            order: 0,
            createdById: user.id,
            updatedById: user.id,
          },
          {
            title: "Story 2",
            featureId: feature.id,
            order: 1,
            createdById: user.id,
            updatedById: user.id,
          },
        ],
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        user
      );

      const response = await GET(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 200);
      const expectedStoriesCount = 3; // Created above in specific order
      expect(data.data).toHaveLength(expectedStoriesCount);
      expect(data.data[0].title).toBe("Story 1");
      expect(data.data[1].title).toBe("Story 2");
      expect(data.data[2].title).toBe("Story 3");
    });

    test("requires authentication", async () => {
      const request = createGetRequest(
        "http://localhost:3000/api/features/test-id/user-stories"
      );

      const response = await GET(request, { params: Promise.resolve({ featureId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates feature exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/features/non-existent-id/user-stories",
        user
      );

      const response = await GET(request, { params: Promise.resolve({ featureId: "non-existent-id" }) });

      await expectError(response, "Feature not found", 404);
    });

    test("denies access to non-workspace members", async () => {
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
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        nonMember
      );

      const response = await GET(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Access denied", 403);
    });

    test("returns empty array when feature has no user stories", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      const feature = await db.feature.create({
        data: {
          title: "Empty Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        user
      );

      const response = await GET(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data).toHaveLength(0);
    });
  });

  describe("POST /api/features/[featureId]/user-stories", () => {
    test("creates user story with auto-incremented order", async () => {
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

      await db.userStory.create({
        data: {
          title: "Existing Story",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        { title: "New Story" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data).toMatchObject({
        title: "New Story",
        order: 1,
        completed: false,
        createdById: user.id,
        updatedById: user.id,
      });
    });

    test("creates first story with order 0", async () => {
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        { title: "First Story" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(0);
    });

    test("requires authentication", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/features/test-id/user-stories",
        { title: "New Story" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates required title field", async () => {
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        {},
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Missing required field: title", 400);
    });

    test("validates title is non-empty string", async () => {
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        { title: "   " },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Missing required field: title", 400);
    });

    test("trims whitespace from title", async () => {
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        { title: "  Trimmed Story  " },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Trimmed Story");
    });

    test("validates feature exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/non-existent-id/user-stories",
        { title: "New Story" },
        user
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: "non-existent-id" }) });

      await expectError(response, "Feature not found", 404);
    });

    test("denies access to non-workspace members", async () => {
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        { title: "New Story" },
        nonMember
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Access denied", 403);
    });
  });

  describe("PATCH /api/user-stories/[storyId]", () => {
    test("updates title", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Original Title",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { title: "Updated Title" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ storyId: story.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.title).toBe("Updated Title");
      expect(data.data.updatedById).toBe(user.id);
    });

    test("updates order", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { order: 5 },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ storyId: story.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.order).toBe(5);
    });

    test("updates completed status", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          completed: false,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { completed: true },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ storyId: story.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data.completed).toBe(true);
    });

    test("updates multiple fields at once", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          completed: false,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { title: "New Title", order: 3, completed: true },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ storyId: story.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data).toMatchObject({
        title: "New Title",
        order: 3,
        completed: true,
      });
    });

    test("requires authentication", async () => {
      const request = createPatchRequest(
        "http://localhost:3000/api/user-stories/test-id",
        { title: "Updated" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ storyId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates user story exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPatchRequest(
        "http://localhost:3000/api/user-stories/non-existent-id",
        { title: "Updated" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ storyId: "non-existent-id" }) });

      await expectError(response, "User story not found", 404);
    });

    test("validates title is non-empty string", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { title: "   " },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ storyId: story.id }) });

      await expectError(response, "Invalid title", 400);
    });

    test("validates order is non-negative", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { order: -1 },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ storyId: story.id }) });

      await expectError(response, "Invalid order", 400);
    });

    test("validates completed is boolean", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { completed: "true" },
        user
      );

      const response = await PATCH(request, { params: Promise.resolve({ storyId: story.id }) });

      await expectError(response, "Invalid completed", 400);
    });

    test("denies access to non-workspace members", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { title: "Updated" },
        nonMember
      );

      const response = await PATCH(request, { params: Promise.resolve({ storyId: story.id }) });

      await expectError(response, "Access denied", 403);
    });
  });

  describe("DELETE /api/user-stories/[storyId]", () => {
    test("deletes user story successfully", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        user
      );

      const response = await DELETE(request, { params: Promise.resolve({ storyId: story.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      const deletedStory = await db.userStory.findUnique({
        where: { id: story.id },
      });
      expect(deletedStory).toBeNull();
    });

    test("requires authentication", async () => {
      const request = createDeleteRequest(
        "http://localhost:3000/api/user-stories/test-id"
      );

      const response = await DELETE(request, { params: Promise.resolve({ storyId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates user story exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedDeleteRequest(
        "http://localhost:3000/api/user-stories/non-existent-id",
        user
      );

      const response = await DELETE(request, { params: Promise.resolve({ storyId: "non-existent-id" }) });

      await expectError(response, "User story not found", 404);
    });

    test("denies access to non-workspace members", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        nonMember
      );

      const response = await DELETE(request, { params: Promise.resolve({ storyId: story.id }) });

      await expectError(response, "Access denied", 403);
    });
  });

  describe("POST /api/features/[featureId]/user-stories/reorder", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    test("reorders user stories successfully and persists new order", async () => {
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

      // Create 3 stories with initial order [0, 1, 2]
      const story1 = await db.userStory.create({
        data: {
          title: "Story 1",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const story2 = await db.userStory.create({
        data: {
          title: "Story 2",
          featureId: feature.id,
          order: 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const story3 = await db.userStory.create({
        data: {
          title: "Story 3",
          featureId: feature.id,
          order: 2,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Reorder to [Story 3, Story 1, Story 2] with new order [0, 1, 2]
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        {
          stories: [
            { id: story3.id, order: 0 },
            { id: story1.id, order: 1 },
            { id: story2.id, order: 2 },
          ],
        },
        user
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(3);

      // Verify database state reflects new order
      const updatedStories = await db.userStory.findMany({
        where: { featureId: feature.id },
        orderBy: { order: "asc" },
      });

      expect(updatedStories).toHaveLength(3);
      expect(updatedStories[0].id).toBe(story3.id);
      expect(updatedStories[0].order).toBe(0);
      expect(updatedStories[1].id).toBe(story1.id);
      expect(updatedStories[1].order).toBe(1);
      expect(updatedStories[2].id).toBe(story2.id);
      expect(updatedStories[2].order).toBe(2);
    });

    test("requires authentication", async () => {
      const request = createPostRequest(
        "http://localhost:3000/api/features/test-id/user-stories/reorder",
        {
          stories: [{ id: "story-id", order: 0 }],
        }
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: "test-id" }),
      });

      await expectUnauthorized(response);
    });

    test("denies access to non-workspace members", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        {
          stories: [{ id: story.id, order: 0 }],
        },
        nonMember
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("validates feature exists", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedPostRequest(
        "http://localhost:3000/api/features/non-existent-id/user-stories/reorder",
        {
          stories: [{ id: "story-id", order: 0 }],
        },
        user
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: "non-existent-id" }),
      });

      await expectError(response, "Feature not found", 404);
    });

    test("rejects deleted workspace features", async () => {
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Soft delete workspace
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        {
          stories: [{ id: story.id, order: 0 }],
        },
        user
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Feature not found", 404);
    });

    test("validates stories array is provided", async () => {
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        { stories: "not-an-array" },
        user
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Stories must be an array", 500);
    });

    test("handles empty stories array gracefully", async () => {
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

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        { stories: [] },
        user
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Empty array is technically valid - should return empty array
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual([]);
    });

    test("prevents cross-feature story reordering", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create two features in same workspace
      const feature1 = await db.feature.create({
        data: {
          title: "Feature 1",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const feature2 = await db.feature.create({
        data: {
          title: "Feature 2",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create story in feature 1
      const story1 = await db.userStory.create({
        data: {
          title: "Story in Feature 1",
          featureId: feature1.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create story in feature 2
      const story2 = await db.userStory.create({
        data: {
          title: "Story in Feature 2",
          featureId: feature2.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Attempt to reorder story from feature 2 in feature 1's endpoint
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature1.id}/user-stories/reorder`,
        {
          stories: [
            { id: story1.id, order: 0 },
            { id: story2.id, order: 1 }, // Wrong feature!
          ],
        },
        user
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature1.id }),
      });

      // Transaction fails because story2 doesn't match featureId in WHERE clause
      // Prisma returns "not found" error which maps to 404
      expect(response.status).toBe(404);

      // Verify original order is preserved (transaction rolled back)
      const story1Check = await db.userStory.findUnique({
        where: { id: story1.id },
      });
      const story2Check = await db.userStory.findUnique({
        where: { id: story2.id },
      });

      expect(story1Check?.order).toBe(0);
      expect(story1Check?.featureId).toBe(feature1.id);
      expect(story2Check?.order).toBe(0);
      expect(story2Check?.featureId).toBe(feature2.id);
    });

    test("rolls back transaction on partial failure with invalid story ID", async () => {
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

      const story1 = await db.userStory.create({
        data: {
          title: "Story 1",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const story2 = await db.userStory.create({
        data: {
          title: "Story 2",
          featureId: feature.id,
          order: 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Attempt reorder with one invalid story ID in the middle
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        {
          stories: [
            { id: story1.id, order: 0 },
            { id: "non-existent-story-id", order: 1 }, // Invalid!
            { id: story2.id, order: 2 },
          ],
        },
        user
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Prisma transaction fails with "not found" error, mapped to 404
      expect(response.status).toBe(404);

      // Verify original order is preserved (no partial updates)
      const updatedStories = await db.userStory.findMany({
        where: { featureId: feature.id },
        orderBy: { order: "asc" },
      });

      expect(updatedStories).toHaveLength(2);
      expect(updatedStories[0].id).toBe(story1.id);
      expect(updatedStories[0].order).toBe(0); // Original order
      expect(updatedStories[1].id).toBe(story2.id);
      expect(updatedStories[1].order).toBe(1); // Original order
    });

    test("handles reordering with duplicate order values", async () => {
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

      const story1 = await db.userStory.create({
        data: {
          title: "Story 1",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const story2 = await db.userStory.create({
        data: {
          title: "Story 2",
          featureId: feature.id,
          order: 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Reorder with duplicate order values (both order: 0)
      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        {
          stories: [
            { id: story1.id, order: 0 },
            { id: story2.id, order: 0 }, // Duplicate order
          ],
        },
        user
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      // Should succeed - database allows duplicate order values
      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      // Verify both stories have order 0
      const updatedStories = await db.userStory.findMany({
        where: { featureId: feature.id },
      });

      expect(updatedStories).toHaveLength(2);
      expect(updatedStories.every((s) => s.order === 0)).toBe(true);
    });

    test("allows workspace owner to reorder stories", async () => {
      const owner = await createTestUser();
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

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        {
          stories: [{ id: story.id, order: 5 }],
        },
        owner
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      // Verify owner can reorder
      const updatedStory = await db.userStory.findUnique({
        where: { id: story.id },
      });
      expect(updatedStory?.order).toBe(5);
    });

    test("allows workspace member to reorder stories", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Add member to workspace
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: "DEVELOPER",
        },
      });

      const feature = await db.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const story = await db.userStory.create({
        data: {
          title: "Test Story",
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const request = createAuthenticatedPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        {
          stories: [{ id: story.id, order: 3 }],
        },
        member
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      // Verify member can reorder
      const updatedStory = await db.userStory.findUnique({
        where: { id: story.id },
      });
      expect(updatedStory?.order).toBe(3);
    });
  });
});
