import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/tasks/notifications-count/route";
import { NextRequest } from "next/server";

// Mock all dependencies
vi.mock("@/lib/auth/nextauth");
vi.mock("@/lib/db");

import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";

// Test Data Helpers - Centralized mock data creation
const createMockSession = (userId?: string) => ({
  user: {
    id: userId || "user-123",
    email: "test@example.com",
    name: "Test User",
  },
  expires: new Date(Date.now() + 86400000).toISOString(),
});

const createMockWorkspace = (overrides = {}) => ({
  id: "workspace-123",
  ownerId: "user-123",
  members: [],
  ...overrides,
});

const createMockTask = (overrides = {}) => ({
  id: "task-123",
  chatMessages: [],
  ...overrides,
});

const createMockChatMessage = (artifactTypes: string[] = []) => ({
  artifacts: artifactTypes.map((type) => ({ type })),
});

const createMockArtifact = (type: string) => ({ type });

// Helper to create NextRequest with proper params
const createRequest = (slug: string) => {
  const url = `http://localhost:3000/api/workspaces/${slug}/tasks/notifications-count`;
  return new NextRequest(url);
};

describe("GET /api/workspaces/[slug]/tasks/notifications-count - Unit Tests", () => {
  let mockGetServerSession: ReturnType<typeof vi.fn>;
  let mockDbWorkspaceFindFirst: ReturnType<typeof vi.fn>;
  let mockDbTaskFindMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock implementations
    mockGetServerSession = vi.mocked(getServerSession);
    mockDbWorkspaceFindFirst = vi.fn();
    mockDbTaskFindMany = vi.fn();

    // Mock db methods
    vi.mocked(db).workspace = {
      findFirst: mockDbWorkspaceFindFirst,
    } as any;

    vi.mocked(db).task = {
      findMany: mockDbTaskFindMany,
    } as any;
  });

  describe("Authentication", () => {
    it("should return 401 when user is not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: "Unauthorized" });
    });

    it("should return 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValue({
        expires: new Date().toISOString(),
      });

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: "Unauthorized" });
    });

    it("should return 401 when user session has no id", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date().toISOString(),
      });

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: "Invalid user session" });
    });
  });

  describe("Request Validation", () => {
    it("should return 400 when slug is missing", async () => {
      mockGetServerSession.mockResolvedValue(createMockSession());

      const request = createRequest("");
      const params = Promise.resolve({ slug: "" });
      const response = await GET(request, { params });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toEqual({ error: "Workspace slug is required" });
    });
  });

  describe("Workspace Authorization", () => {
    it("should return 404 when workspace is not found", async () => {
      mockGetServerSession.mockResolvedValue(createMockSession());
      mockDbWorkspaceFindFirst.mockResolvedValue(null);

      const request = createRequest("nonexistent-workspace");
      const params = Promise.resolve({ slug: "nonexistent-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({ error: "Workspace not found" });
      expect(mockDbWorkspaceFindFirst).toHaveBeenCalledWith({
        where: {
          slug: "nonexistent-workspace",
          deleted: false,
        },
        select: {
          id: true,
          ownerId: true,
          members: {
            where: {
              userId: "user-123",
              leftAt: null,
            },
            select: {
              role: true,
            },
          },
        },
      });
    });

    it("should return 403 when user is not workspace owner or member", async () => {
      mockGetServerSession.mockResolvedValue(createMockSession("user-456"));
      mockDbWorkspaceFindFirst.mockResolvedValue(
        createMockWorkspace({
          ownerId: "user-123",
          members: [],
        })
      );

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data).toEqual({ error: "Access denied" });
    });

    it("should allow access for workspace owner", async () => {
      mockGetServerSession.mockResolvedValue(createMockSession("owner-123"));
      mockDbWorkspaceFindFirst.mockResolvedValue(
        createMockWorkspace({
          id: "workspace-123",
          ownerId: "owner-123",
          members: [],
        })
      );
      mockDbTaskFindMany.mockResolvedValue([]);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
    });

    it("should allow access for workspace member", async () => {
      mockGetServerSession.mockResolvedValue(createMockSession("member-123"));
      mockDbWorkspaceFindFirst.mockResolvedValue(
        createMockWorkspace({
          id: "workspace-123",
          ownerId: "owner-123",
          members: [{ role: "DEVELOPER" }],
        })
      );
      mockDbTaskFindMany.mockResolvedValue([]);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
    });
  });

  describe("Notification Counting Logic", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue(createMockSession());
      mockDbWorkspaceFindFirst.mockResolvedValue(
        createMockWorkspace({
          id: "workspace-123",
          ownerId: "user-123",
          members: [],
        })
      );
    });

    it("should count tasks with FORM artifacts in latest message", async () => {
      mockDbTaskFindMany.mockResolvedValue([
        createMockTask({
          id: "task-1",
          chatMessages: [createMockChatMessage(["FORM"])],
        }),
        createMockTask({
          id: "task-2",
          chatMessages: [createMockChatMessage(["FORM"])],
        }),
      ]);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        success: true,
        data: {
          waitingForInputCount: 2,
        },
      });
    });

    it("should exclude tasks without FORM artifacts", async () => {
      mockDbTaskFindMany.mockResolvedValue([
        createMockTask({
          id: "task-1",
          chatMessages: [createMockChatMessage(["CODE"])],
        }),
        createMockTask({
          id: "task-2",
          chatMessages: [createMockChatMessage(["BROWSER"])],
        }),
      ]);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });

    it("should count tasks with mixed artifact types if FORM is present", async () => {
      mockDbTaskFindMany.mockResolvedValue([
        createMockTask({
          id: "task-1",
          chatMessages: [createMockChatMessage(["FORM", "CODE", "BROWSER"])],
        }),
      ]);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(1);
    });

    it("should exclude tasks with no chat messages", async () => {
      mockDbTaskFindMany.mockResolvedValue([
        createMockTask({
          id: "task-1",
          chatMessages: [],
        }),
      ]);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });

    it("should exclude tasks with empty artifacts array", async () => {
      mockDbTaskFindMany.mockResolvedValue([
        createMockTask({
          id: "task-1",
          chatMessages: [{ artifacts: [] }],
        }),
      ]);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });

    it("should return 0 when no tasks exist", async () => {
      mockDbTaskFindMany.mockResolvedValue([]);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        success: true,
        data: {
          waitingForInputCount: 0,
        },
      });
    });

    it("should verify correct Prisma query filters", async () => {
      mockDbTaskFindMany.mockResolvedValue([]);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      await GET(request, { params });

      expect(mockDbTaskFindMany).toHaveBeenCalledWith({
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
  });

  describe("Error Handling", () => {
    it("should return 500 when workspace query fails", async () => {
      mockGetServerSession.mockResolvedValue(createMockSession());
      mockDbWorkspaceFindFirst.mockRejectedValue(
        new Error("Database connection failed")
      );

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        error: "Failed to fetch task notification count",
      });
    });

    it("should return 500 when task query fails", async () => {
      mockGetServerSession.mockResolvedValue(createMockSession());
      mockDbWorkspaceFindFirst.mockResolvedValue(
        createMockWorkspace({
          id: "workspace-123",
          ownerId: "user-123",
        })
      );
      mockDbTaskFindMany.mockRejectedValue(new Error("Query timeout"));

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        error: "Failed to fetch task notification count",
      });
    });

    it("should handle unexpected errors gracefully", async () => {
      mockGetServerSession.mockRejectedValue(new Error("Unexpected error"));

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        error: "Failed to fetch task notification count",
      });
    });
  });

  describe("Edge Cases", () => {
    beforeEach(() => {
      mockGetServerSession.mockResolvedValue(createMockSession());
      mockDbWorkspaceFindFirst.mockResolvedValue(
        createMockWorkspace({
          id: "workspace-123",
          ownerId: "user-123",
        })
      );
    });

    it("should handle tasks with null chatMessages gracefully", async () => {
      mockDbTaskFindMany.mockResolvedValue([
        createMockTask({
          id: "task-1",
          chatMessages: null,
        }),
      ]);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });

    it("should handle tasks with undefined artifacts gracefully", async () => {
      mockDbTaskFindMany.mockResolvedValue([
        createMockTask({
          id: "task-1",
          chatMessages: [{ artifacts: undefined }],
        }),
      ]);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(0);
    });

    it("should handle large numbers of tasks efficiently", async () => {
      const manyTasks = Array.from({ length: 100 }, (_, i) =>
        createMockTask({
          id: `task-${i}`,
          chatMessages: [createMockChatMessage(i % 2 === 0 ? ["FORM"] : ["CODE"])],
        })
      );
      mockDbTaskFindMany.mockResolvedValue(manyTasks);

      const request = createRequest("test-workspace");
      const params = Promise.resolve({ slug: "test-workspace" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.waitingForInputCount).toBe(50);
    });
  });
});