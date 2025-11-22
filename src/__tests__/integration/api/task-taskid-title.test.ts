import { describe, it, expect, beforeEach, vi, beforeAll, afterAll, afterEach } from "vitest";
import { db } from "@/lib/db";
import type { User, Workspace, Task } from "@prisma/client";
import { PUT } from "@/app/api/tasks/[taskId]/title/route";
import { createRequestWithHeaders } from "@/__tests__/support/helpers/request-builders";
import { generateUniqueId, generateUniqueSlug } from "@/__tests__/support/helpers/ids";

// Mock NextAuth - not needed for API token auth but prevents import errors
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock Pusher to verify broadcasts without actual WebSocket connections
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((id: string) => `task-${id}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

// Import the mocked Pusher utilities after mocking
const { pusherServer, getTaskChannelName, getWorkspaceChannelName } = await import("@/lib/pusher");
const mockPusherTrigger = vi.mocked(pusherServer.trigger);
const mockGetTaskChannelName = vi.mocked(getTaskChannelName);
const mockGetWorkspaceChannelName = vi.mocked(getWorkspaceChannelName);

describe("PUT /api/tasks/[taskId]/title", () => {
  let testUser: User;
  let testWorkspace: Workspace;
  let testTask: Task;
  const originalApiToken = process.env.API_TOKEN;
  const TEST_API_TOKEN = "test-api-token-12345";

  // Helper function to create a PUT request with API token
  function createPutRequestWithToken(taskId: string, body: any, token?: string) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (token) {
      headers["x-api-token"] = token;
    }

    return createRequestWithHeaders(
      `http://localhost:3000/api/tasks/${taskId}/title`,
      "PUT",
      headers,
      body
    );
  }

  beforeAll(() => {
    // Set API token for tests
    process.env.API_TOKEN = TEST_API_TOKEN;
  });

  beforeEach(async () => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Create test data using transaction for atomicity
    const testData = await db.$transaction(async (tx) => {
      // Create test user
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `test-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      // Create test workspace
      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
          members: {
            create: {
              userId: user.id,
              role: "OWNER",
            },
          },
        },
      });

      // Create test task
      const task = await tx.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Original Task Title",
          workspaceId: workspace.id,
          deleted: false,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      return { user, workspace, task };
    });

    testUser = testData.user;
    testWorkspace = testData.workspace;
    testTask = testData.task;
  });

  afterEach(async () => {
    // Cleanup test data
    if (testTask) {
      await db.task.deleteMany({ where: { workspaceId: testWorkspace.id } });
    }
    if (testWorkspace) {
      await db.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } });
      await db.workspace.delete({ where: { id: testWorkspace.id } });
    }
    if (testUser) {
      await db.user.delete({ where: { id: testUser.id } });
    }
  });

  afterAll(() => {
    // Restore original API token
    process.env.API_TOKEN = originalApiToken;
  });

  describe("Authentication", () => {
    it("should return 401 when API token is missing", async () => {
      const request = createPutRequestWithToken(testTask.id, { title: "New Title" });
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when API token is invalid", async () => {
      const request = createPutRequestWithToken(testTask.id, { title: "New Title" }, "invalid-token");
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("should return 400 when title is missing", async () => {
      const request = createPutRequestWithToken(testTask.id, {}, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });

    it("should return 400 when title is empty string", async () => {
      const request = createPutRequestWithToken(testTask.id, { title: "" }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });

    it("should return 400 when title is not a string", async () => {
      const request = createPutRequestWithToken(testTask.id, { title: 123 }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });
  });

  describe("Task Retrieval", () => {
    it("should return 404 when task does not exist", async () => {
      const nonExistentId = "00000000-0000-0000-0000-000000000000";
      const request = createPutRequestWithToken(nonExistentId, { title: "New Title" }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: nonExistentId }) });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });

    it("should return 404 when task is soft-deleted", async () => {
      // Create a soft-deleted task
      const deletedTask = await db.task.create({
        data: {
          id: generateUniqueId("deleted-task"),
          title: "Deleted Task",
          workspaceId: testWorkspace.id,
          deleted: true,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      const request = createPutRequestWithToken(deletedTask.id, { title: "New Title" }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: deletedTask.id }) });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });
  });

  describe("Successful Title Update", () => {
    it("should update task title and return 200", async () => {
      const newTitle = "Updated Task Title";
      const originalUpdatedAt = testTask.updatedAt;

      const request = createPutRequestWithToken(testTask.id, { title: newTitle }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify response payload
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.id).toBe(testTask.id);
      expect(data.data.title).toBe(newTitle);
      expect(data.data.workspaceId).toBe(testWorkspace.id);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });

      expect(updatedTask).toBeDefined();
      expect(updatedTask!.title).toBe(newTitle);
      expect(updatedTask!.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime()
      );
    });

    it("should trim whitespace from title", async () => {
      const titleWithWhitespace = "  Title With Whitespace  ";
      const expectedTitle = "Title With Whitespace";

      const request = createPutRequestWithToken(testTask.id, { title: titleWithWhitespace }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.title).toBe(expectedTitle);

      // Verify in database
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask!.title).toBe(expectedTitle);
    });

    it("should return success without update when title is unchanged", async () => {
      const originalTitle = testTask.title;

      const request = createPutRequestWithToken(testTask.id, { title: originalTitle }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe("Title unchanged");
      expect(data.data.title).toBe(originalTitle);
    });
  });

  describe("Pusher Broadcasting", () => {
    it("should broadcast to task-specific channel", async () => {
      const newTitle = "Broadcasted Title";

      const request = createPutRequestWithToken(testTask.id, { title: newTitle }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(200);

      // Verify task channel name was generated
      expect(mockGetTaskChannelName).toHaveBeenCalledWith(testTask.id);

      // Verify Pusher trigger was called for task channel
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        `task-${testTask.id}`,
        "task-title-update",
        expect.objectContaining({
          taskId: testTask.id,
          newTitle,
          previousTitle: testTask.title,
          timestamp: expect.any(Date),
        })
      );
    });

    it("should broadcast to workspace channel", async () => {
      const newTitle = "Workspace Broadcasted Title";

      const request = createPutRequestWithToken(testTask.id, { title: newTitle }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(200);

      // Verify workspace channel name was generated
      expect(mockGetWorkspaceChannelName).toHaveBeenCalledWith(
        testWorkspace.slug
      );

      // Verify Pusher trigger was called for workspace channel
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        `workspace-${testWorkspace.slug}`,
        "workspace-task-title-update",
        expect.objectContaining({
          taskId: testTask.id,
          newTitle,
          previousTitle: testTask.title,
          timestamp: expect.any(Date),
        })
      );
    });

    it("should broadcast to both channels in a single update", async () => {
      const newTitle = "Dual Channel Title";

      const request = createPutRequestWithToken(testTask.id, { title: newTitle }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(200);

      // Verify both triggers were called
      expect(mockPusherTrigger).toHaveBeenCalledTimes(2);

      // Verify task channel trigger
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        `task-${testTask.id}`,
        "task-title-update",
        expect.any(Object)
      );

      // Verify workspace channel trigger
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        `workspace-${testWorkspace.slug}`,
        "workspace-task-title-update",
        expect.any(Object)
      );
    });

    it("should succeed even if Pusher broadcasting fails", async () => {
      // Mock Pusher trigger to throw error
      mockPusherTrigger.mockRejectedValueOnce(new Error("Pusher error"));

      const newTitle = "Title Despite Pusher Failure";

      const request = createPutRequestWithToken(testTask.id, { title: newTitle }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      // Request should still succeed
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify database was updated despite Pusher failure
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask!.title).toBe(newTitle);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long titles", async () => {
      const longTitle = "A".repeat(500);

      const request = createPutRequestWithToken(testTask.id, { title: longTitle }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.title).toBe(longTitle);
    });

    it("should handle special characters in title", async () => {
      const specialTitle = "Task with émojis 🚀 and symbols @#$%";

      const request = createPutRequestWithToken(testTask.id, { title: specialTitle }, TEST_API_TOKEN);
      const response = await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.title).toBe(specialTitle);

      // Verify in database
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect(updatedTask!.title).toBe(specialTitle);
    });

    it("should handle concurrent updates correctly", async () => {
      // Simulate two concurrent updates
      const title1 = "Concurrent Update 1";
      const title2 = "Concurrent Update 2";

      const request1 = createPutRequestWithToken(testTask.id, { title: title1 }, TEST_API_TOKEN);
      const request2 = createPutRequestWithToken(testTask.id, { title: title2 }, TEST_API_TOKEN);

      const [response1, response2] = await Promise.all([
        PUT(request1, { params: Promise.resolve({ taskId: testTask.id }) }),
        PUT(request2, { params: Promise.resolve({ taskId: testTask.id }) }),
      ]);

      // Both should succeed
      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // Final database state should be one of the two titles
      const finalTask = await db.task.findUnique({
        where: { id: testTask.id },
      });
      expect([title1, title2]).toContain(finalTask!.title);
    });
  });

  describe("Database State Verification", () => {
    it("should not update other task fields", async () => {
      const newTitle = "Only Title Changed";
      const originalWorkspaceId = testTask.workspaceId;
      const originalDeleted = testTask.deleted;

      const request = createPutRequestWithToken(testTask.id, { title: newTitle }, TEST_API_TOKEN);
      await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });

      // Verify only title and updatedAt changed
      expect(updatedTask!.title).toBe(newTitle);
      expect(updatedTask!.workspaceId).toBe(originalWorkspaceId);
      expect(updatedTask!.deleted).toBe(originalDeleted);
    });

    it("should update updatedAt timestamp", async () => {
      const originalUpdatedAt = testTask.updatedAt;

      // Wait a small amount to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const request = createPutRequestWithToken(testTask.id, { title: "New Timestamped Title" }, TEST_API_TOKEN);
      await PUT(request, { params: Promise.resolve({ taskId: testTask.id }) });

      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });

      expect(updatedTask!.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime()
      );
    });
  });
});
