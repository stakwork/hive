import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/search/route";
import { db } from "@/lib/db";
import { FeatureStatus, FeaturePriority, TaskStatus, Priority, TaskStatus, PhaseStatus } from "@prisma/client";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import {
  expectSuccess,
  expectUnauthorized,
  expectError,
  createAuthenticatedGetRequest,
  createGetRequest,
} from "@/__tests__/support/helpers";

describe("Workspace Search API - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/[slug]/search", () => {
    test("searches across tasks, features, and phases", async () => {
      // Setup
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
        slug: "test-workspace",
      });

      // Create test data
      await db.task.create({
        data: {
          title: "Call API integration",
          description: "Implement call recording API",
          workspaceId: workspace.id,
          status: TaskStatus.TODO,
          priority: Priority.HIGH,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const feature = await db.feature.create({
        data: {
          title: "Call Recording Feature",
          brief: "Add support for call recordings",
          workspaceId: workspace.id,
          status: FeatureStatus.IN_PROGRESS,
          priority: FeaturePriority.HIGH,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const phase = await db.phase.create({
        data: {
          name: "Call Storage Phase",
          description: "Store call recordings",
          featureId: feature.id,
          status: PhaseStatus.IN_PROGRESS,
        },
      });

      await db.task.create({
        data: {
          title: "Call 4 implementation",
          description: "Implement call 4 feature",
          workspaceId: workspace.id,
          featureId: feature.id,
          phaseId: phase.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/test-workspace/search?q=call`,
        user,
      );

      // Execute
      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      // Assert
      const data = await expectSuccess(response, 200);
      expect(data.data.total).toBe(4);
      expect(data.data.tasks).toHaveLength(2); // Both standalone and roadmap tasks
      expect(data.data.features).toHaveLength(1);
      expect(data.data.phases).toHaveLength(1);

      // Verify standalone task result
      const standaloneTask = data.data.tasks.find((t: any) => t.title === "Call API integration");
      expect(standaloneTask).toMatchObject({
        type: "task",
        title: "Call API integration",
        metadata: {
          status: TaskStatus.TODO,
          priority: Priority.HIGH,
        },
      });
      expect(standaloneTask.url).toMatch(/^\/w\/test-workspace\/task\/.+/);

      // Verify feature result
      expect(data.data.features[0]).toMatchObject({
        type: "feature",
        title: "Call Recording Feature",
        url: "/w/test-workspace/roadmap/" + feature.id,
        metadata: {
          status: FeatureStatus.IN_PROGRESS,
          priority: FeaturePriority.HIGH,
        },
      });

      // Verify roadmap task result (previously called "ticket")
      const roadmapTask = data.data.tasks.find((t: any) => t.title === "Call 4 implementation");
      expect(roadmapTask).toMatchObject({
        type: "task",
        title: "Call 4 implementation",
        metadata: {
          featureTitle: "Call Recording Feature",
        },
      });

      // Verify phase result
      expect(data.data.phases[0]).toMatchObject({
        type: "phase",
        title: "Call Storage Phase",
        metadata: {
          featureTitle: "Call Recording Feature",
        },
      });
    });

    test("is case-insensitive", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "test-workspace",
      });

      await db.task.create({
        data: {
          title: "CALL API Integration",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/test-workspace/search?q=call`,
        user,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data.tasks).toHaveLength(1);
      expect(data.data.tasks[0].title).toBe("CALL API Integration");
    });

    test("searches in description fields", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "test-workspace",
      });

      await db.task.create({
        data: {
          title: "Task 1",
          description: "This task involves call recording",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/test-workspace/search?q=recording`,
        user,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data.tasks).toHaveLength(1);
    });

    test("limits results to 5 per entity type", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "test-workspace",
      });

      // Create 10 tasks with "test" in title
      for (let i = 0; i < 10; i++) {
        await db.task.create({
          data: {
            title: `Test task ${i + 1}`,
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
          },
        });
      }

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/test-workspace/search?q=test`,
        user,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data.tasks).toHaveLength(5); // Limited to 5
    });

    test("returns most recently updated results first", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "test-workspace",
      });

      const oldTask = await db.task.create({
        data: {
          title: "Old test task",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          updatedAt: new Date("2023-01-01"),
        },
      });

      const newTask = await db.task.create({
        data: {
          title: "New test task",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
          updatedAt: new Date("2024-01-01"),
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/test-workspace/search?q=test`,
        user,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data.tasks[0].id).toBe(newTask.id); // Most recent first
      expect(data.data.tasks[1].id).toBe(oldTask.id);
    });

    test("excludes deleted entities", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "test-workspace",
      });

      await db.task.create({
        data: {
          title: "Active test task",
          workspaceId: workspace.id,
          deleted: false,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      await db.task.create({
        data: {
          title: "Deleted test task",
          workspaceId: workspace.id,
          deleted: true,
          deletedAt: new Date(),
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/test-workspace/search?q=test`,
        user,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data.tasks).toHaveLength(1);
      expect(data.data.tasks[0].title).toBe("Active test task");
    });

    test("requires minimum 2 character query", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/test-workspace/search?q=a`,
        user,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      await expectError(response, "Search query must be at least 2 characters", 400);
    });

    test("requires query parameter", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedGetRequest(`http://localhost:3000/api/workspaces/test-workspace/search`, user);

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      await expectError(response, "Search query must be at least 2 characters", 400);
    });

    test("requires authentication", async () => {
      const request = createGetRequest("http://localhost:3000/api/workspaces/test-workspace/search?q=test");

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      await expectUnauthorized(response);
    });

    test("denies access to non-workspace members", async () => {
      const owner = await createTestUser();
      const nonMember = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        slug: "test-workspace",
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/test-workspace/search?q=test`,
        nonMember,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      await expectError(response, "Access denied", 403);
    });

    test("returns 404 for non-existent workspace", async () => {
      const user = await createTestUser();

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/non-existent/search?q=test`,
        user,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "non-existent" }),
      });

      await expectError(response, "Workspace not found", 404);
    });

    test("handles empty results gracefully", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        slug: "test-workspace",
      });

      const request = createAuthenticatedGetRequest(
        `http://localhost:3000/api/workspaces/test-workspace/search?q=nonexistent`,
        user,
      );

      const response = await GET(request, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.data.total).toBe(0);
      expect(data.data.tasks).toHaveLength(0);
      expect(data.data.features).toHaveLength(0);
      expect(data.data.phases).toHaveLength(0);
    });
  });
});
