import { GET } from "@/app/api/tasks/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import {
  mockNextRequest,
  mockGetServerSession,
  createTestUser,
  createTestWorkspace,
  createTestWorkspaceMember,
  createTestTask,
  createTestRepository,
  cleanupDatabase,
  expectErrorResponse,
  expectSuccessResponse,
  mockConsole,
} from "@/tests/utils/test-helpers";
import {
  mockUsers,
  mockWorkspaces,
  mockSessions,
  mockUrls,
} from "@/tests/utils/mock-data";

// Mock NextAuth
jest.mock("next-auth/next");
jest.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
    },
  },
}));

describe("GET /api/tasks", () => {
  mockConsole();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (process.env.NODE_ENV !== "test") {
      await cleanupDatabase();
    }
  });

  describe("Authentication", () => {
    it("should return 401 when no session", async () => {
      mockGetServerSession(null);
      const request = mockNextRequest(mockUrls.getTasks("test-workspace-id"));
      const response = await GET(request);
      expectErrorResponse(response, 401, "Unauthorized");
    });

    it("should return 401 when session has no user", async () => {
      mockGetServerSession({ expires: "future-date" });
      const request = mockNextRequest(mockUrls.getTasks("test-workspace-id"));
      const response = await GET(request);
      expectErrorResponse(response, 401, "Unauthorized");
    });

    it("should return 401 when session user has no ID", async () => {
      mockGetServerSession(mockSessions.invalidUser);
      const request = mockNextRequest(mockUrls.getTasks("test-workspace-id"));
      const response = await GET(request);
      expectErrorResponse(response, 401, "Invalid user session");
    });
  });

  describe("Request Validation", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
    });

    it("should return 400 when workspaceId is missing", async () => {
      const request = mockNextRequest(mockUrls.getTasksNoParam);
      const response = await GET(request);
      expectErrorResponse(response, 400, "workspaceId query parameter is required");
    });

    it("should extract workspaceId from search params correctly", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.task.findMany as jest.Mock).mockResolvedValue([]);

      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      await GET(request);

      expect(db.workspace.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockWorkspaces.primary.id,
          deleted: false,
        },
        select: {
          id: true,
          ownerId: true,
          members: {
            where: {
              userId: mockUsers.owner.id,
            },
            select: {
              role: true,
            },
          },
        },
      });
    });
  });

  describe("Workspace Authorization", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
    });

    it("should return 404 when workspace not found", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue(null);
      const request = mockNextRequest(mockUrls.getTasks("non-existent-workspace"));
      const response = await GET(request);
      expectErrorResponse(response, 404, "Workspace not found");
    });

    it("should return 404 when workspace is deleted", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue(null); // findFirst won't return deleted workspaces
      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.deleted.id));
      const response = await GET(request);
      expectErrorResponse(response, 404, "Workspace not found");
    });

    it("should allow access for workspace owner", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.task.findMany as jest.Mock).mockResolvedValue([]);

      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
    });

    it("should allow access for workspace member", async () => {
      mockGetServerSession(mockSessions.member);
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [{ role: "MEMBER" }], // Has membership
      });
      (db.task.findMany as jest.Mock).mockResolvedValue([]);

      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
    });

    it("should return 403 when user is not owner or member", async () => {
      mockGetServerSession(mockSessions.nonMember);
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [], // No membership found
      });

      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      const response = await GET(request);

      expectErrorResponse(response, 403, "Access denied");
    });
  });

  describe("Task Querying", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
    });

    it("should query tasks with correct parameters", async () => {
      (db.task.findMany as jest.Mock).mockResolvedValue([]);
      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      await GET(request);

      expect(db.task.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: mockWorkspaces.primary.id,
          deleted: false,
        },
        include: {
          assignee: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          repository: {
            select: {
              id: true,
              name: true,
              repositoryUrl: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          _count: {
            select: {
              chatMessages: true,
              comments: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    });

    it("should return tasks data in correct format", async () => {
      const mockTasksData = [
        {
          id: "task-1",
          title: "Task 1",
          assignee: { id: "user-1", name: "User 1", email: "user1@example.com" },
          repository: { id: "repo-1", name: "Repo 1", repositoryUrl: "https://github.com/test/repo1" },
          createdBy: { id: "user-2", name: "User 2", email: "user2@example.com" },
          _count: { chatMessages: 5, comments: 2 },
        },
      ];
      (db.task.findMany as jest.Mock).mockResolvedValue(mockTasksData);

      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
      expect(response.data.data).toEqual(mockTasksData);
    });

    it("should return empty array when no tasks found", async () => {
      (db.task.findMany as jest.Mock).mockResolvedValue([]);
      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
      expect(response.data.data).toEqual([]);
    });

    it("should exclude deleted tasks", async () => {
      (db.task.findMany as jest.Mock).mockResolvedValue([]);
      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      await GET(request);

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deleted: false,
          }),
        })
      );
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
    });

    it("should handle database errors gracefully", async () => {
      (db.workspace.findFirst as jest.Mock).mockRejectedValue(new Error("Database connection failed"));
      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      const response = await GET(request);

      expectErrorResponse(response, 500, "Failed to fetch tasks");
      expect(console.error).toHaveBeenCalledWith("Error fetching tasks:", expect.any(Error));
    });

    it("should handle task query errors gracefully", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.task.findMany as jest.Mock).mockRejectedValue(new Error("Task query failed"));

      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      const response = await GET(request);

      expectErrorResponse(response, 500, "Failed to fetch tasks");
    });

    it("should handle workspace query timeout", async () => {
      (db.workspace.findFirst as jest.Mock).mockRejectedValue(new Error("Query timeout"));
      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      const response = await GET(request);

      expectErrorResponse(response, 500, "Failed to fetch tasks");
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
    });

    it("should handle URL with multiple workspaceId parameters", async () => {
      const urlWithMultipleParams = `http://localhost:3000/api/tasks?workspaceId=${mockWorkspaces.primary.id}&workspaceId=duplicate`;
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.task.findMany as jest.Mock).mockResolvedValue([]);

      const request = mockNextRequest(urlWithMultipleParams);
      const response = await GET(request);

      expectSuccessResponse(response, 200);
    });

    it("should handle workspace with null ownerId", async () => {
      mockGetServerSession(mockSessions.member);
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: null,
        members: [{ role: "MEMBER" }],
      });
      (db.task.findMany as jest.Mock).mockResolvedValue([]);

      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
    });

    it("should handle tasks with null relationships", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      const tasksWithNullRelations = [
        {
          id: "task-1",
          title: "Task without assignee",
          assignee: null,
          repository: null,
          createdBy: { id: "user-1", name: "User 1", email: "user1@example.com" },
          _count: { chatMessages: 0, comments: 0 },
        },
      ];
      (db.task.findMany as jest.Mock).mockResolvedValue(tasksWithNullRelations);

      const request = mockNextRequest(mockUrls.getTasks(mockWorkspaces.primary.id));
      const response = await GET(request);

      expectSuccessResponse(response, 200);
      expect(response.data.data[0].assignee).toBeNull();
      expect(response.data.data[0].repository).toBeNull();
    });
  });
});