import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/tasks/[taskId]/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";

// Mock next-auth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock authOptions
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    task: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("DELETE /api/tasks/[taskId] - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  const mockSession = {
    user: { id: "user1" },
  };

  const mockTask = {
    id: "task1",
    title: "Test Task",
    description: "Test Description",
    workspaceId: "workspace1",
    status: TaskStatus.TODO,
    priority: Priority.MEDIUM,
    deleted: false,
    deletedAt: null,
    workspace: {
      id: "workspace1",
      ownerId: "user1",
      members: [],
    },
  };

  describe("Authentication", () => {
    test("should return 401 for unauthenticated user", async () => {
      (getServerSession as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "DELETE",
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.task.update).not.toHaveBeenCalled();
    });

    test("should return 401 for invalid user session", async () => {
      (getServerSession as Mock).mockResolvedValue({ user: {} });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "DELETE",
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
      expect(db.task.update).not.toHaveBeenCalled();
    });
  });

  describe("Task Validation", () => {
    test("should return 404 for non-existent task", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/non-existent",
        {
          method: "DELETE",
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: "non-existent" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
      expect(db.task.update).not.toHaveBeenCalled();
    });

    test("should return 404 for already deleted task", async () => {
      const deletedTask = {
        ...mockTask,
        deleted: true,
        deletedAt: new Date(),
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(null); // Query filters deleted: false

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "DELETE",
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
      expect(db.task.update).not.toHaveBeenCalled();
    });
  });

  describe("Authorization", () => {
    test("should return 403 for user without workspace access", async () => {
      const taskWithoutAccess = {
        ...mockTask,
        workspace: {
          id: "workspace1",
          ownerId: "different-user",
          members: [], // User is not a member
        },
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(taskWithoutAccess);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "DELETE",
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
      expect(db.task.update).not.toHaveBeenCalled();
    });

    test("should allow workspace owner to delete task", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        ...mockTask,
        deleted: true,
        deletedAt: new Date(),
      });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "DELETE",
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });

      expect(response.status).toBe(200);
      expect(db.task.update).toHaveBeenCalled();
    });

    test("should allow workspace member to delete task", async () => {
      const taskWithMember = {
        ...mockTask,
        workspace: {
          id: "workspace1",
          ownerId: "different-user",
          members: [{ role: "DEVELOPER" }], // User is a member
        },
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(taskWithMember);
      (db.task.update as Mock).mockResolvedValue({
        ...mockTask,
        deleted: true,
        deletedAt: new Date(),
      });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "DELETE",
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });

      expect(response.status).toBe(200);
      expect(db.task.update).toHaveBeenCalled();
    });
  });

  describe("Soft Delete", () => {
    test("should perform soft delete with deleted flag and timestamp", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        ...mockTask,
        deleted: true,
        deletedAt: new Date(),
      });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "DELETE",
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Task deleted successfully");

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: {
          deleted: true,
          deletedAt: expect.any(Date),
        },
      });
    });

    test("should return success message after deletion", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        ...mockTask,
        deleted: true,
        deletedAt: new Date(),
      });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "DELETE",
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Task deleted successfully");
    });
  });

  describe("Query Validation", () => {
    test("should verify deleted: false filter in findFirst query", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        ...mockTask,
        deleted: true,
        deletedAt: new Date(),
      });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "DELETE",
        }
      );

      await DELETE(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });

      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: "task1",
          deleted: false,
        },
        include: {
          workspace: {
            select: {
              id: true,
              ownerId: true,
              members: {
                where: {
                  userId: "user1",
                },
                select: {
                  role: true,
                },
              },
            },
          },
        },
      });
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on database error", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockRejectedValue(
        new Error("Database connection failed")
      );

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "DELETE",
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to delete task");
    });
  });

  describe("Response Format", () => {
    test("should return JSON with success flag and message", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        ...mockTask,
        deleted: true,
        deletedAt: new Date(),
      });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "DELETE",
        }
      );

      const response = await DELETE(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.headers.get("content-type")).toContain(
        "application/json"
      );
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("message");
      expect(data.success).toBe(true);
    });
  });
});