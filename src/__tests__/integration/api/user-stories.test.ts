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
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  createGetRequest,
  createPostRequest,
  createPatchRequest,
  createDeleteRequest,
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`
      );

      const response = await GET(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 200);
      expect(data.data).toHaveLength(3);
      expect(data.data[0].title).toBe("Story 1");
      expect(data.data[1].title).toBe("Story 2");
      expect(data.data[2].title).toBe("Story 3");
    });

    test("requires authentication", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost:3000/api/features/test-id/user-stories"
      );

      const response = await GET(request, { params: Promise.resolve({ featureId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates feature exists", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/features/non-existent-id/user-stories"
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createGetRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        { title: "New Story" }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        { title: "First Story" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.order).toBe(0);
    });

    test("requires authentication", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(
        "http://localhost:3000/api/features/test-id/user-stories",
        { title: "New Story" }
      );

      const response = await POST(request, { params: { featureId: "test-id" } });

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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        {}
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        { title: "   " }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        { title: "  Trimmed Story  " }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      const data = await expectSuccess(response, 201);
      expect(data.data.title).toBe("Trimmed Story");
    });

    test("validates feature exists", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/features/non-existent-id/user-stories",
        { title: "New Story" }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories`,
        { title: "New Story" }
      );

      const response = await POST(request, { params: Promise.resolve({ featureId: feature.id }) });

      await expectError(response, "Access denied", 403);
    });
  });

  describe("POST /api/features/[featureId]/user-stories/reorder", () => {
    test("reorders user stories successfully with database verification", async () => {
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

      const story3 = await db.userStory.create({
        data: {
          title: "Story 3",
          featureId: feature.id,
          order: 2,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        {
          stories: [
            { id: story3.id, order: 0 },
            { id: story1.id, order: 1 },
            { id: story2.id, order: 2 },
          ],
        }
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(3);

      const updatedStories = await db.userStory.findMany({
        where: { featureId: feature.id },
        orderBy: { order: "asc" },
      });

      expect(updatedStories[0].id).toBe(story3.id);
      expect(updatedStories[0].order).toBe(0);
      expect(updatedStories[1].id).toBe(story1.id);
      expect(updatedStories[1].order).toBe(1);
      expect(updatedStories[2].id).toBe(story2.id);
      expect(updatedStories[2].order).toBe(2);
    });

    test("requires authentication", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(
        "http://localhost:3000/api/features/test-id/user-stories/reorder",
        { stories: [] }
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: "test-id" }),
      });

      await expectUnauthorized(response);
    });

    test("validates feature exists", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/features/non-existent-id/user-stories/reorder",
        { stories: [] }
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: "non-existent-id" }),
      });

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

      const story = await db.userStory.create({
        data: {
          title: "Story 1",
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        { stories: [{ id: story.id, order: 0 }] }
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Access denied", 403);
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        { stories: "not-an-array" }
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "Stories must be an array", 500);
    });

    test("handles invalid story ID in batch with transaction rollback", async () => {
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        {
          stories: [
            { id: story1.id, order: 1 },
            { id: "invalid-story-id", order: 0 },
          ],
        }
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      await expectError(response, "record was found", 404);

      const storiesAfterFailure = await db.userStory.findMany({
        where: { featureId: feature.id },
        orderBy: { order: "asc" },
      });

      expect(storiesAfterFailure[0].id).toBe(story1.id);
      expect(storiesAfterFailure[0].order).toBe(0);
      expect(storiesAfterFailure[1].id).toBe(story2.id);
      expect(storiesAfterFailure[1].order).toBe(1);
    });

    test("prevents reordering stories from different features", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

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

      const story1 = await db.userStory.create({
        data: {
          title: "Story 1",
          featureId: feature1.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const story2 = await db.userStory.create({
        data: {
          title: "Story 2",
          featureId: feature2.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature1.id}/user-stories/reorder`,
        {
          stories: [
            { id: story1.id, order: 1 },
            { id: story2.id, order: 0 },
          ],
        }
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature1.id }),
      });

      await expectError(response, "record was found", 404);

      const feature1Stories = await db.userStory.findMany({
        where: { featureId: feature1.id },
      });
      expect(feature1Stories[0].order).toBe(0);

      const feature2Stories = await db.userStory.findMany({
        where: { featureId: feature2.id },
      });
      expect(feature2Stories[0].order).toBe(0);
    });

    test("allows workspace member to reorder stories", async () => {
      const owner = await createTestUser();
      const member = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

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

      const story1 = await db.userStory.create({
        data: {
          title: "Story 1",
          featureId: feature.id,
          order: 0,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const story2 = await db.userStory.create({
        data: {
          title: "Story 2",
          featureId: feature.id,
          order: 1,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        {
          stories: [
            { id: story2.id, order: 0 },
            { id: story1.id, order: 1 },
          ],
        }
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      const updatedStories = await db.userStory.findMany({
        where: { featureId: feature.id },
        orderBy: { order: "asc" },
      });

      expect(updatedStories[0].id).toBe(story2.id);
      expect(updatedStories[1].id).toBe(story1.id);
    });

    test("reorders single story successfully", async () => {
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
          title: "Story 1",
          featureId: feature.id,
          order: 0,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        `http://localhost:3000/api/features/${feature.id}/user-stories/reorder`,
        { stories: [{ id: story.id, order: 5 }] }
      );

      const response = await POST_REORDER(request, {
        params: Promise.resolve({ featureId: feature.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);

      const updatedStory = await db.userStory.findUnique({
        where: { id: story.id },
      });

      expect(updatedStory?.order).toBe(5);
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { title: "Updated Title" }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { order: 5 }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { completed: true }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { title: "New Title", order: 3, completed: true }
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
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPatchRequest(
        "http://localhost:3000/api/user-stories/test-id",
        { title: "Updated" }
      );

      const response = await PATCH(request, { params: Promise.resolve({ storyId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates user story exists", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        "http://localhost:3000/api/user-stories/non-existent-id",
        { title: "Updated" }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { title: "   " }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { order: -1 }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { completed: "true" }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createPatchRequest(
        `http://localhost:3000/api/user-stories/${story.id}`,
        { title: "Updated" }
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createDeleteRequest(
        `http://localhost:3000/api/user-stories/${story.id}`
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
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createDeleteRequest(
        "http://localhost:3000/api/user-stories/test-id"
      );

      const response = await DELETE(request, { params: Promise.resolve({ storyId: "test-id" }) });

      await expectUnauthorized(response);
    });

    test("validates user story exists", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createDeleteRequest(
        "http://localhost:3000/api/user-stories/non-existent-id"
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

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createDeleteRequest(
        `http://localhost:3000/api/user-stories/${story.id}`
      );

      const response = await DELETE(request, { params: Promise.resolve({ storyId: story.id }) });

      await expectError(response, "Access denied", 403);
    });
  });
});
