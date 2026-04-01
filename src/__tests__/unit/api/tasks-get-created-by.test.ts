import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/tasks/route";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

function authedGetRequest(url: string, userId = "user1") {
  const headers = new Headers();
  headers.set("x-middleware-auth-status", "authenticated");
  headers.set("x-middleware-user-id", userId);
  headers.set("x-middleware-user-email", "test@example.com");
  headers.set("x-middleware-user-name", "Test User");
  return new NextRequest(url, { method: "GET", headers });
}

const mockWorkspace = {
  id: "workspace1",
  ownerId: "user1",
  members: [{ role: "DEVELOPER" }],
};

const mockTask = {
  id: "task1",
  title: "Task by Creator",
  description: null,
  status: "IN_PROGRESS",
  workflowStatus: "PENDING",
  priority: "MEDIUM",
  sourceType: "USER",
  archived: false,
  deleted: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdById: "creator1",
  updatedById: "creator1",
  workspaceId: "workspace1",
  assigneeId: null,
  repositoryId: null,
  podId: null,
  branch: null,
  autoMerge: false,
  featureId: null,
  phaseId: null,
  mode: null,
  systemAssigneeType: null,
  agentUrl: null,
  agentPassword: null,
  deploymentStatus: null,
  deployedToStagingAt: null,
  deployedToProductionAt: null,
  artifacts: [],
  assignee: null,
  repository: null,
};

describe("GET /api/tasks - createdById filter (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.task.findMany as Mock).mockResolvedValue([mockTask]);
    (db.task.count as Mock).mockResolvedValue(1);
  });

  test("passes createdById to Prisma whereClause when param is set", async () => {
    const request = authedGetRequest(
      "http://localhost:3000/api/tasks?workspaceId=workspace1&createdById=creator1"
    );

    const response = await GET(request);
    expect(response.status).toBe(200);

    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdById: "creator1",
        }),
      })
    );
  });

  test("does NOT include createdById in whereClause when param is omitted", async () => {
    const request = authedGetRequest(
      "http://localhost:3000/api/tasks?workspaceId=workspace1"
    );

    const response = await GET(request);
    expect(response.status).toBe(200);

    const callArgs = (db.task.findMany as Mock).mock.calls[0][0];
    expect(callArgs.where).not.toHaveProperty("createdById");
  });
});
