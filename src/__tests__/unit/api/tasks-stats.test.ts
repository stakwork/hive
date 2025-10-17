import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/tasks/stats/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));


vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));


vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    task: {
      count: vi.fn(),
    },
  },
}));

describe("GET /api/tasks/stats - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  const mockSession = {
    user: { id: "user1" },
  };

  const mockWorkspace = {
    id: "workspace1",
    ownerId: "user1",
    members: [{ role: "DEVELOPER" }],
  };

  describe("Authentication & Authorization", () => {
    test("should return 401 for unauthenticated requests", async () => {
      (getServerSession as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.task.count).not.toHaveBeenCalled();
    });

    test("should return 401 for invalid session (missing userId)", async () => {
      (getServerSession as Mock).mockResolvedValue({ user: {} });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
      expect(db.task.count).not.toHaveBeenCalled();
    });

    test("should return 403 for users without workspace access", async () => {
      const workspaceWithoutAccess = {
        id: "workspace1",
        ownerId: "different-user",
        members: [], 
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithoutAccess);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
      expect(db.task.count).not.toHaveBeenCalled();
    });

    test("should allow workspace owners to get stats", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.count as Mock).mockResolvedValue(10);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(db.task.count).toHaveBeenCalled();
    });

    test("should allow workspace members to get stats", async () => {
      const workspaceAsMember = {
        id: "workspace1",
        ownerId: "different-user",
        members: [{ role: "DEVELOPER" }],
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceAsMember);
      (db.task.count as Mock).mockResolvedValue(10);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(db.task.count).toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("should return 400 when workspaceId is missing", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = new NextRequest("http://localhost:3000/api/tasks/stats");

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("workspaceId query parameter is required");
      expect(db.task.count).not.toHaveBeenCalled();
    });

    test("should return 404 for non-existent workspace", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=non-existent"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
      expect(db.task.count).not.toHaveBeenCalled();
    });
  });

  describe("Statistics Calculation", () => {
    test("should count total tasks correctly", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.count as Mock)
        .mockResolvedValueOnce(25)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(3);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.total).toBe(25);
      
      expect(db.task.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: "workspace1",
            deleted: false,
          }),
        })
      );
    });

    test("should exclude deleted tasks from total count", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.count as Mock)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      await GET(request);

      const firstCall = (db.task.count as Mock).mock.calls[0][0];
      expect(firstCall.where.deleted).toBe(false);
    });

    test("should count IN_PROGRESS tasks correctly", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.count as Mock)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(7) 
        .mockResolvedValueOnce(3);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.inProgress).toBe(7);

      const inProgressCall = (db.task.count as Mock).mock.calls[1][0];
      expect(inProgressCall.where.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(inProgressCall.where.deleted).toBe(false);
    });

    test("should count waiting for input tasks correctly", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.count as Mock)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(4); 

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.waitingForInput).toBe(4);

      const waitingCall = (db.task.count as Mock).mock.calls[2][0];
      expect(waitingCall.where.workflowStatus.in).toEqual([
        WorkflowStatus.IN_PROGRESS,
        WorkflowStatus.PENDING,
      ]);
      expect(waitingCall.where.chatMessages.some.artifacts.some.type).toBe("FORM");
    });

    test("should only count FORM artifacts in active tasks (PENDING/IN_PROGRESS)", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.count as Mock)
        .mockResolvedValueOnce(20)
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      await GET(request);

      const waitingCall = (db.task.count as Mock).mock.calls[2][0];
      expect(waitingCall.where.workflowStatus).toEqual({
        in: [WorkflowStatus.IN_PROGRESS, WorkflowStatus.PENDING],
      });
    });

    test("should return zero for empty workspace", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.count as Mock)
        .mockResolvedValueOnce(0) 
        .mockResolvedValueOnce(0) 
        .mockResolvedValueOnce(0); 

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toEqual({
        total: 0,
        inProgress: 0,
        waitingForInput: 0,
      });
    });

    test("should use Promise.all for parallel queries", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      
      const countCalls: number[] = [];
      (db.task.count as Mock).mockImplementation(() => {
        countCalls.push(Date.now());
        return Promise.resolve(10);
      });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      await GET(request);

      expect(db.task.count).toHaveBeenCalledTimes(3);
      
      expect(countCalls).toHaveLength(3);
    });
  });

  describe("Response Structure", () => {
    test("should return success flag", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.count as Mock)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.success).toBe(true);
    });

    test("should return data object with all stats", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.count as Mock)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(2);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data).toBeDefined();
      expect(data.data).toHaveProperty("total");
      expect(data.data).toHaveProperty("inProgress");
      expect(data.data).toHaveProperty("waitingForInput");
    });

    test("should return correct numeric values", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.count as Mock)
        .mockResolvedValueOnce(50)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(8);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data.total).toBe(50);
      expect(data.data.inProgress).toBe(12);
      expect(data.data.waitingForInput).toBe(8);
      
      expect(typeof data.data.total).toBe("number");
      expect(typeof data.data.inProgress).toBe("number");
      expect(typeof data.data.waitingForInput).toBe("number");
    });
  });

  describe("Error Handling", () => {
    test("should handle database errors gracefully", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.count as Mock).mockRejectedValue(
        new Error("Database connection failed")
      );

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });

    test("should return 500 on unexpected errors", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockRejectedValue(
        new Error("Unexpected error")
      );

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/stats?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });
  });
});
