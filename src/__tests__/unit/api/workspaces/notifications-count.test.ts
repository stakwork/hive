import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { GET } from "@/app/api/workspaces/[slug]/tasks/notifications-count/route";

// Mock next-auth
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
  authOptions: {},
}));

// Mock authOptions
// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
  },
}));

const { db: mockDb } = await import("@/lib/db");

// Test Data Factories
const TestDataFactory = {
  createValidSession: (userId: string = "user-123") => ({
    user: { id: userId, email: "test@example.com", name: "Test User" },
  }),

  createValidWorkspace: (ownerId: string = "user-123") => ({
    id: "workspace-123",
    ownerId,
    members: [],
  }),

  createWorkspaceWithMember: (userId: string = "member-456") => ({
    id: "workspace-123",
    ownerId: "owner-123",
    members: [{ role: "DEVELOPER" }],
  }),

  createTaskWithFormArtifact: (taskId: string = "task-1") => ({
    id: taskId,
    chatMessages: [
      {
        artifacts: [{ type: "FORM" }],
      },
    ],
  }),

  createTaskWithCodeArtifact: (taskId: string = "task-2") => ({
    id: taskId,
    chatMessages: [
      {
        artifacts: [{ type: "CODE" }],
      },
    ],
  }),

  createTaskWithNoMessages: (taskId: string = "task-3") => ({
    id: taskId,
    chatMessages: [],
  }),

  createTaskWithMultipleMessages: (taskId: string = "task-4", latestHasForm: boolean = true) => ({
    id: taskId,
    chatMessages: [
      {
        artifacts: latestHasForm ? [{ type: "FORM" }] : [{ type: "CODE" }],
      },
    ],
  }),

  createTaskWithMultipleArtifacts: (taskId: string = "task-5") => ({
    id: taskId,
    chatMessages: [
      {
        artifacts: [{ type: "FORM" }, { type: "CODE" }, { type: "BROWSER" }],
      },
    ],
  }),
};

// Test Helpers
const TestHelpers = {
  createGetRequest: (slug: string) => {
    return new NextRequest(`http://localhost:3000/api/workspaces/${slug}/tasks/notifications-count`, {
      method: "GET",
    });
  },

  setupAuthenticatedUser: (userId: string = "user-123") => {
    (mockGetServerSession as Mock).mockResolvedValue(TestDataFactory.createValidSession(userId));
  },

  setupUnauthenticatedUser: () => {
    (mockGetServerSession as Mock).mockResolvedValue(null);
  },

  setupInvalidSession: () => {
    (mockGetServerSession as Mock).mockResolvedValue({ user: {} });
  },

  expectAuthenticationError: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  },

  expectInvalidSessionError: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Invalid user session");
  },

  expectAccessDeniedError: async (response: Response) => {
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toBe("Access denied");
  },

  expectWorkspaceNotFoundError: async (response: Response) => {
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Workspace not found");
  },

  expectSuccessResponse: async (response: Response, expectedCount: number) => {
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.waitingForInputCount).toBe(expectedCount);
  },
};

describe("GET /api/workspaces/[slug]/tasks/notifications-count - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      TestHelpers.setupUnauthenticatedUser();

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectAuthenticationError(response);
      expect(mockDb.workspace.findFirst).not.toHaveBeenCalled();
    });

    test("should return 401 when session exists but user is missing", async () => {
      (mockGetServerSession as Mock).mockResolvedValue({ expires: new Date().toISOString() });

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectAuthenticationError(response);
      expect(mockDb.workspace.findFirst).not.toHaveBeenCalled();
    });

    test("should return 401 when session.user.id is missing", async () => {
      TestHelpers.setupInvalidSession();

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectInvalidSessionError(response);
      expect(mockDb.workspace.findFirst).not.toHaveBeenCalled();
    });

    test("should proceed with valid session", async () => {
      TestHelpers.setupAuthenticatedUser();
      (mockDb.workspace.findFirst as Mock).mockResolvedValue(TestDataFactory.createValidWorkspace());
      (mockDb.task.findMany as Mock).mockResolvedValue([]);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      expect(response.status).toBe(200);
      expect(mockGetServerSession).toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("should return 400 when slug is missing", async () => {
      TestHelpers.setupAuthenticatedUser();

      const request = TestHelpers.createGetRequest("");
      const response = await GET(request, { params: Promise.resolve({ slug: "" }) });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Workspace slug is required");
      expect(mockDb.workspace.findFirst).not.toHaveBeenCalled();
    });

    test("should accept valid slug parameter", async () => {
      TestHelpers.setupAuthenticatedUser();
      (mockDb.workspace.findFirst as Mock).mockResolvedValue(TestDataFactory.createValidWorkspace());
      (mockDb.task.findMany as Mock).mockResolvedValue([]);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      expect(response.status).toBe(200);
      expect(mockDb.workspace.findFirst).toHaveBeenCalledWith({
        where: {
          slug: "test-workspace",
          deleted: false,
        },
        select: {
          id: true,
          ownerId: true,
          members: {
            where: {
              userId: "user-123",
            },
            select: {
              role: true,
            },
          },
        },
      });
    });
  });

  describe("Authorization", () => {
    test("should return 404 when workspace is not found", async () => {
      TestHelpers.setupAuthenticatedUser();
      (mockDb.workspace.findFirst as Mock).mockResolvedValue(null);

      const request = TestHelpers.createGetRequest("non-existent-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "non-existent-workspace" }) });

      await TestHelpers.expectWorkspaceNotFoundError(response);
      expect(mockDb.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 403 when user is not workspace owner or member", async () => {
      TestHelpers.setupAuthenticatedUser("user-123");
      const workspaceWithoutAccess = {
        id: "workspace-123",
        ownerId: "different-owner",
        members: [], // No members, user not owner
      };
      (mockDb.workspace.findFirst as Mock).mockResolvedValue(workspaceWithoutAccess);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectAccessDeniedError(response);
      expect(mockDb.task.findMany).not.toHaveBeenCalled();
    });

    test("should allow access when user is workspace owner", async () => {
      TestHelpers.setupAuthenticatedUser("user-123");
      (mockDb.workspace.findFirst as Mock).mockResolvedValue(TestDataFactory.createValidWorkspace("user-123"));
      (mockDb.task.findMany as Mock).mockResolvedValue([]);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 0);
      expect(mockDb.task.findMany).toHaveBeenCalled();
    });

    test("should allow access when user is workspace member", async () => {
      TestHelpers.setupAuthenticatedUser("member-456");
      (mockDb.workspace.findFirst as Mock).mockResolvedValue(TestDataFactory.createWorkspaceWithMember("member-456"));
      (mockDb.task.findMany as Mock).mockResolvedValue([]);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 0);
      expect(mockDb.task.findMany).toHaveBeenCalled();
    });
  });

  describe("Counting Logic - Task Filtering", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
      (mockDb.workspace.findFirst as Mock).mockResolvedValue(TestDataFactory.createValidWorkspace());
    });

    test("should count tasks with FORM artifacts in latest message", async () => {
      const tasksWithForm = [
        TestDataFactory.createTaskWithFormArtifact("task-1"),
        TestDataFactory.createTaskWithFormArtifact("task-2"),
      ];
      (mockDb.task.findMany as Mock).mockResolvedValue(tasksWithForm);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 2);
    });

    test("should exclude tasks with non-FORM artifacts", async () => {
      const tasksWithoutForm = [
        TestDataFactory.createTaskWithCodeArtifact("task-1"),
        TestDataFactory.createTaskWithFormArtifact("task-2"),
      ];
      (mockDb.task.findMany as Mock).mockResolvedValue(tasksWithoutForm);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 1);
    });

    test("should exclude tasks with no chat messages", async () => {
      const tasksWithNoMessages = [
        TestDataFactory.createTaskWithNoMessages("task-1"),
        TestDataFactory.createTaskWithFormArtifact("task-2"),
      ];
      (mockDb.task.findMany as Mock).mockResolvedValue(tasksWithNoMessages);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 1);
    });

    test("should only check latest message for FORM artifacts", async () => {
      const tasksWithMultipleMessages = [
        TestDataFactory.createTaskWithMultipleMessages("task-1", true), // Latest has FORM
        TestDataFactory.createTaskWithMultipleMessages("task-2", false), // Latest has CODE
      ];
      (mockDb.task.findMany as Mock).mockResolvedValue(tasksWithMultipleMessages);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 1);
    });

    test("should count task once even with multiple FORM artifacts", async () => {
      const taskWithMultipleForms = [TestDataFactory.createTaskWithMultipleArtifacts("task-1")];
      (mockDb.task.findMany as Mock).mockResolvedValue(taskWithMultipleForms);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 1);
    });

    test("should return zero count when no tasks have FORM artifacts", async () => {
      const tasksWithoutForm = [
        TestDataFactory.createTaskWithCodeArtifact("task-1"),
        TestDataFactory.createTaskWithCodeArtifact("task-2"),
      ];
      (mockDb.task.findMany as Mock).mockResolvedValue(tasksWithoutForm);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 0);
    });

    test("should return zero count when workspace has no tasks", async () => {
      (mockDb.task.findMany as Mock).mockResolvedValue([]);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 0);
    });
  });

  describe("Prisma Query Validation", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
      (mockDb.workspace.findFirst as Mock).mockResolvedValue(TestDataFactory.createValidWorkspace());
      (mockDb.task.findMany as Mock).mockResolvedValue([]);
    });

    test("should query tasks with correct workspace filter", async () => {
      const request = TestHelpers.createGetRequest("test-workspace");
      await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      expect(mockDb.task.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: "workspace-123",
          deleted: false,
          workflowStatus: {
            in: ["IN_PROGRESS", "PENDING"],
          },
        },
        select: {
          id: true,
          chatMessages: {
            orderBy: {
              timestamp: "desc",
            },
            take: 1,
            select: {
              artifacts: {
                select: {
                  type: true,
                },
              },
            },
          },
        },
      });
    });

    test("should filter by IN_PROGRESS and PENDING workflow status", async () => {
      const request = TestHelpers.createGetRequest("test-workspace");
      await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      expect(mockDb.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workflowStatus: {
              in: ["IN_PROGRESS", "PENDING"],
            },
          }),
        }),
      );
    });

    test("should exclude deleted tasks", async () => {
      const request = TestHelpers.createGetRequest("test-workspace");
      await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      expect(mockDb.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deleted: false,
          }),
        }),
      );
    });

    test("should order chat messages by timestamp desc and take only 1", async () => {
      const request = TestHelpers.createGetRequest("test-workspace");
      await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      expect(mockDb.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            chatMessages: expect.objectContaining({
              orderBy: {
                timestamp: "desc",
              },
              take: 1,
            }),
          }),
        }),
      );
    });
  });

  describe("Response Format", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
      (mockDb.workspace.findFirst as Mock).mockResolvedValue(TestDataFactory.createValidWorkspace());
    });

    test("should return correct response structure", async () => {
      (mockDb.task.findMany as Mock).mockResolvedValue([TestDataFactory.createTaskWithFormArtifact("task-1")]);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });
      const data = await response.json();

      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("waitingForInputCount");
      expect(typeof data.data.waitingForInputCount).toBe("number");
    });

    test("should return accurate count in response", async () => {
      const tasksWithForm = [
        TestDataFactory.createTaskWithFormArtifact("task-1"),
        TestDataFactory.createTaskWithFormArtifact("task-2"),
        TestDataFactory.createTaskWithFormArtifact("task-3"),
      ];
      (mockDb.task.findMany as Mock).mockResolvedValue(tasksWithForm);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });
      const data = await response.json();

      expect(data.data.waitingForInputCount).toBe(3);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
    });

    test("should return 500 when workspace lookup fails", async () => {
      (mockDb.workspace.findFirst as Mock).mockRejectedValue(new Error("Database connection failed"));

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to fetch task notification count");
    });

    test("should return 500 when task query fails", async () => {
      (mockDb.workspace.findFirst as Mock).mockResolvedValue(TestDataFactory.createValidWorkspace());
      (mockDb.task.findMany as Mock).mockRejectedValue(new Error("Query timeout"));

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to fetch task notification count");
    });

    test("should handle malformed workspace data gracefully", async () => {
      (mockDb.workspace.findFirst as Mock).mockResolvedValue({
        id: "workspace-123",
        // Missing ownerId and members
      });

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      expect(response.status).toBe(500);
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      TestHelpers.setupAuthenticatedUser();
      (mockDb.workspace.findFirst as Mock).mockResolvedValue(TestDataFactory.createValidWorkspace());
    });

    test("should handle tasks with null chatMessages array", async () => {
      const tasksWithNullMessages = [{ id: "task-1", chatMessages: null }];
      (mockDb.task.findMany as Mock).mockResolvedValue(tasksWithNullMessages);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 0);
    });

    test("should handle tasks with undefined artifacts", async () => {
      const tasksWithUndefinedArtifacts = [
        {
          id: "task-1",
          chatMessages: [
            {
              artifacts: undefined,
            },
          ],
        },
      ];
      (mockDb.task.findMany as Mock).mockResolvedValue(tasksWithUndefinedArtifacts);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 0);
    });

    test("should handle tasks with null artifacts", async () => {
      const tasksWithNullArtifacts = [
        {
          id: "task-1",
          chatMessages: [
            {
              artifacts: null,
            },
          ],
        },
      ];
      (mockDb.task.findMany as Mock).mockResolvedValue(tasksWithNullArtifacts);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 0);
    });

    test("should handle tasks with empty artifacts array", async () => {
      const tasksWithEmptyArtifacts = [
        {
          id: "task-1",
          chatMessages: [
            {
              artifacts: [],
            },
          ],
        },
      ];
      (mockDb.task.findMany as Mock).mockResolvedValue(tasksWithEmptyArtifacts);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 0);
    });

    test("should handle mixed artifact types correctly", async () => {
      const mixedTasks = [
        TestDataFactory.createTaskWithFormArtifact("task-1"),
        TestDataFactory.createTaskWithCodeArtifact("task-2"),
        {
          id: "task-3",
          chatMessages: [
            {
              artifacts: [{ type: "BROWSER" }],
            },
          ],
        },
        {
          id: "task-4",
          chatMessages: [
            {
              artifacts: [{ type: "LONGFORM" }],
            },
          ],
        },
        TestDataFactory.createTaskWithFormArtifact("task-5"),
      ];
      (mockDb.task.findMany as Mock).mockResolvedValue(mixedTasks);

      const request = TestHelpers.createGetRequest("test-workspace");
      const response = await GET(request, { params: Promise.resolve({ slug: "test-workspace" }) });

      await TestHelpers.expectSuccessResponse(response, 2);
    });
  });
});
