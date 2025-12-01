import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { PUT } from "@/app/api/tasks/[taskId]/title/route";
import { createRequestWithHeaders } from "@/__tests__/support/helpers";
import { pusherServer, getTaskChannelName, getWorkspaceChannelName } from "@/lib/pusher";

// Mock NextAuth (following pattern from other integration tests)
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock Pusher to verify broadcast calls without actual WebSocket connections
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

// Get typed mock instances
const mockedPusherServer = vi.mocked(pusherServer);
const mockedGetTaskChannelName = vi.mocked(getTaskChannelName);
const mockedGetWorkspaceChannelName = vi.mocked(getWorkspaceChannelName);

describe("PUT /api/tasks/[taskId]/title", () => {
  // Test environment setup - use mock API token for in-process testing
  const API_TOKEN = "test-api-token";
  
  // Set environment variable for the route handler
  beforeEach(async () => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    mockedPusherServer.trigger.mockResolvedValue({});
    mockedGetTaskChannelName.mockImplementation((taskId: string) => `task-${taskId}`);
    mockedGetWorkspaceChannelName.mockImplementation((slug: string) => `workspace-${slug}`);
    
    // Set API token for route authentication
    process.env.API_TOKEN = API_TOKEN;

    // Clean up test data
    await db.task.deleteMany({});
    await db.workspaceMember.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
  });

  describe("Authentication", () => {
    it("should return 401 when API token is missing", async () => {
      const request = createRequestWithHeaders(
        "http://localhost/api/tasks/test-task-id/title",
        "PUT",
        { "Content-Type": "application/json" },
        { title: "New Title" }
      );
      
      const response = await PUT(request, { params: Promise.resolve({ taskId: "test-task-id" }) });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when API token is invalid", async () => {
      const request = createRequestWithHeaders(
        "http://localhost/api/tasks/test-task-id/title",
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": "invalid-token",
        },
        { title: "New Title" }
      );
      
      const response = await PUT(request, { params: Promise.resolve({ taskId: "test-task-id" }) });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Input Validation", () => {
    it("should return 400 when title is missing", async () => {
      const request = createRequestWithHeaders(
        "http://localhost/api/tasks/test-task-id/title",
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        {}
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: "test-task-id" }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });

    it("should return 400 when title is not a string", async () => {
      const request = createRequestWithHeaders(
        "http://localhost/api/tasks/test-task-id/title",
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: 123 }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: "test-task-id" }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });

    it("should return 400 when title is empty string", async () => {
      const request = createRequestWithHeaders(
        "http://localhost/api/tasks/test-task-id/title",
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: "" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: "test-task-id" }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Title is required and must be a string");
    });
  });

  describe("Task Existence", () => {
    it("should return 404 when task does not exist", async () => {
      const request = createRequestWithHeaders(
        "http://localhost/api/tasks/non-existent-task-id/title",
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: "New Title" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: "non-existent-task-id" }) });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });

    it("should return 404 when task is soft-deleted", async () => {
      // Create test data with transaction
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: "test@example.com",
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: "test-workspace",
            ownerId: user.id,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
              },
            },
          },
        });

        const task = await tx.task.create({
          data: {
            title: "Original Title",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: true, // Soft-deleted task
          },
        });

        return { user, workspace, task };
      });

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/title`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: "New Title" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");

      // Verify task was not updated in database
      const taskInDb = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(taskInDb?.title).toBe("Original Title");
    });
  });

  describe("Successful Updates", () => {
    it("should update task title and persist to database", async () => {
      // Create test data with transaction
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: "test@example.com",
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: "test-workspace",
            ownerId: user.id,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
              },
            },
          },
        });

        const task = await tx.task.create({
          data: {
            title: "Original Title",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: false,
          },
        });

        return { user, workspace, task };
      });

      const newTitle = "Updated Task Title";
      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/title`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: newTitle }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.data.title).toBe(newTitle);
      expect(data.data.id).toBe(testData.task.id);
      expect(data.data.workspaceId).toBe(testData.workspace.id);

      // Verify database persistence
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.title).toBe(newTitle);
      expect(updatedTask?.updatedAt).toBeDefined();
    });

    it("should trim whitespace from title before updating", async () => {
      // Create test data with transaction
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: "test@example.com",
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: "test-workspace",
            ownerId: user.id,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
              },
            },
          },
        });

        const task = await tx.task.create({
          data: {
            title: "Original Title",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: false,
          },
        });

        return { user, workspace, task };
      });

      const titleWithWhitespace = "  Updated Title  ";
      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/title`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: titleWithWhitespace }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.title).toBe("Updated Title");

      // Verify trimmed title in database
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.title).toBe("Updated Title");
    });

    it("should return 200 and skip update when title is unchanged", async () => {
      // Create test data with transaction
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: "test@example.com",
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: "test-workspace",
            ownerId: user.id,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
              },
            },
          },
        });

        const task = await tx.task.create({
          data: {
            title: "Original Title",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: false,
          },
        });

        return { user, workspace, task };
      });

      const originalUpdatedAt = testData.task.updatedAt;

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/title`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: "Original Title" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe("Title unchanged");
      expect(data.data.title).toBe("Original Title");

      // Verify no Pusher broadcasts were made
      expect(mockedPusherServer.trigger).not.toHaveBeenCalled();

      // Verify updatedAt timestamp was not changed
      const taskInDb = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(taskInDb?.updatedAt.getTime()).toBe(originalUpdatedAt.getTime());
    });
  });

  describe("Pusher Broadcasting", () => {
    it("should broadcast title update to task-specific channel", async () => {
      // Create test data with transaction
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: "test@example.com",
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: "test-workspace",
            ownerId: user.id,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
              },
            },
          },
        });

        const task = await tx.task.create({
          data: {
            title: "Original Title",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: false,
          },
        });

        return { user, workspace, task };
      });

      const newTitle = "Updated Title";
      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/title`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: newTitle }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);

      // Verify task channel broadcast
      expect(mockedPusherServer.trigger).toHaveBeenCalledWith(
        `task-${testData.task.id}`,
        "task-title-update",
        expect.objectContaining({
          taskId: testData.task.id,
          newTitle: newTitle,
          previousTitle: "Original Title",
          timestamp: expect.any(Date),
        }),
      );
    });

    it("should broadcast title update to workspace channel", async () => {
      // Create test data with transaction
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: "test@example.com",
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: "test-workspace",
            ownerId: user.id,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
              },
            },
          },
        });

        const task = await tx.task.create({
          data: {
            title: "Original Title",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: false,
          },
        });

        return { user, workspace, task };
      });

      const newTitle = "Updated Title";
      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/title`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: newTitle }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);

      // Verify workspace channel broadcast
      expect(mockedPusherServer.trigger).toHaveBeenCalledWith(
        "workspace-test-workspace",
        "workspace-task-title-update",
        expect.objectContaining({
          taskId: testData.task.id,
          newTitle: newTitle,
          previousTitle: "Original Title",
          timestamp: expect.any(Date),
        }),
      );
    });

    it("should trigger both channel broadcasts for single update", async () => {
      // Create test data with transaction
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: "test@example.com",
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: "test-workspace",
            ownerId: user.id,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
              },
            },
          },
        });

        const task = await tx.task.create({
          data: {
            title: "Original Title",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: false,
          },
        });

        return { user, workspace, task };
      });

      const newTitle = "Updated Title";
      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/title`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: newTitle }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);

      // Verify both broadcasts were triggered
      expect(mockedPusherServer.trigger).toHaveBeenCalledTimes(2);

      // Verify channel name helpers were called
      expect(mockedGetTaskChannelName).toHaveBeenCalledWith(testData.task.id);
      expect(mockedGetWorkspaceChannelName).toHaveBeenCalledWith("test-workspace");
    });

    it("should succeed even if Pusher broadcasting fails", async () => {
      // Mock Pusher to fail
      mockedPusherServer.trigger.mockRejectedValueOnce(new Error("Pusher connection failed"));

      // Create test data with transaction
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: "test@example.com",
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: "test-workspace",
            ownerId: user.id,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
              },
            },
          },
        });

        const task = await tx.task.create({
          data: {
            title: "Original Title",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: false,
          },
        });

        return { user, workspace, task };
      });

      const newTitle = "Updated Title";
      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/title`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: newTitle }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      // Request should still succeed
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify database was still updated
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.title).toBe(newTitle);
    });
  });

  describe("Data Consistency", () => {
    it("should update updatedAt timestamp when title changes", async () => {
      // Create test data with transaction
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: "test@example.com",
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: "test-workspace",
            ownerId: user.id,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
              },
            },
          },
        });

        const task = await tx.task.create({
          data: {
            title: "Original Title",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: false,
          },
        });

        return { user, workspace, task };
      });

      const originalUpdatedAt = testData.task.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/title`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: "New Title" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);

      // Verify updatedAt was changed
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.updatedAt.getTime()).toBeGreaterThan(
        originalUpdatedAt.getTime(),
      );
    });

    it("should maintain workspace relationship after update", async () => {
      // Create test data with transaction
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: "test@example.com",
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: "test-workspace",
            ownerId: user.id,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
              },
            },
          },
        });

        const task = await tx.task.create({
          data: {
            title: "Original Title",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: false,
          },
        });

        return { user, workspace, task };
      });

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/title`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: "New Title" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);

      // Verify workspace relationship is intact
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
        include: { workspace: true },
      });
      expect(updatedTask?.workspaceId).toBe(testData.workspace.id);
      expect(updatedTask?.workspace.slug).toBe("test-workspace");
    });

    it("should not modify other task fields during title update", async () => {
      // Create test data with transaction
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: "test@example.com",
            name: "Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: "test-workspace",
            ownerId: user.id,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
              },
            },
          },
        });

        const task = await tx.task.create({
          data: {
            title: "Original Title",
            workspaceId: workspace.id,
            createdById: user.id,
            updatedById: user.id,
            deleted: false,
            status: "TODO",
            description: "Original description",
          },
        });

        return { user, workspace, task };
      });

      const request = createRequestWithHeaders(
        `http://localhost/api/tasks/${testData.task.id}/title`,
        "PUT",
        {
          "Content-Type": "application/json",
          "x-api-token": API_TOKEN,
        },
        { title: "New Title" }
      );

      const response = await PUT(request, { params: Promise.resolve({ taskId: testData.task.id }) });

      expect(response.status).toBe(200);

      // Verify only title was changed
      const updatedTask = await db.task.findUnique({
        where: { id: testData.task.id },
      });
      expect(updatedTask?.title).toBe("New Title");
      expect(updatedTask?.status).toBe("TODO");
      expect(updatedTask?.description).toBe("Original description");
      expect(updatedTask?.deleted).toBe(false);
      expect(updatedTask?.workspaceId).toBe(testData.workspace.id);
    });
  });
});
