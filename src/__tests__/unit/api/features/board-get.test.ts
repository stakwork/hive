import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/features/board/route";
import { requireAuthOrApiToken } from "@/lib/auth/api-token";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import { WorkspaceRole } from "@/lib/auth/roles";
import { dbMock } from "@/__tests__/support/mocks/prisma";
import { FeatureStatus, FeaturePriority, TaskStatus, Priority } from "@prisma/client";

vi.mock("@/lib/auth/api-token");
vi.mock("@/lib/auth/workspace-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/workspace-access")>(
    "@/lib/auth/workspace-access",
  );
  return {
    ...actual,
    resolveWorkspaceAccess: vi.fn(),
  };
});
vi.mock("@/lib/system-assignees", () => ({
  getSystemAssigneeUser: vi.fn().mockReturnValue(null),
}));

const mockedRequireAuthOrApiToken = vi.mocked(requireAuthOrApiToken);
const mockedResolveWorkspaceAccess = vi.mocked(resolveWorkspaceAccess);

function makeRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/features/board");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

const baseTask = {
  id: "task-1",
  title: "Task 1",
  status: TaskStatus.TODO,
  priority: Priority.MEDIUM,
  dependsOnTaskIds: [],
  featureId: "feature-1",
  systemAssigneeType: null,
  order: 0,
  description: null,
  phaseId: null,
  workspaceId: "ws-1",
  bountyCode: null,
  autoMerge: false,
  deploymentStatus: null,
  deployedToStagingAt: null,
  deployedToProductionAt: null,
  workflowStatus: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  assignee: null,
  repository: null,
  phase: null,
};

const baseFeature = {
  id: "feature-1",
  title: "Feature 1",
  status: FeatureStatus.IN_PROGRESS,
  priority: FeaturePriority.MEDIUM,
  tasks: [baseTask],
};

describe("GET /api/features/board", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a signed-in member (no x-api-token header). The handler
    // resolves access via `resolveWorkspaceAccess`; `requireAuthOrApiToken`
    // is only invoked on the x-api-token fast-path.
    mockedResolveWorkspaceAccess.mockResolvedValue({
      kind: "member",
      userId: "user-1",
      workspaceId: "ws-1",
      slug: "ws-1",
      role: WorkspaceRole.DEVELOPER,
    });
    mockedRequireAuthOrApiToken.mockResolvedValue({
      id: "user-1",
      email: "test@example.com",
    } as any);
  });

  it("returns 400 when workspaceId is missing", async () => {
    mockedRequireAuthOrApiToken.mockResolvedValue({ id: "user-1" } as any);
    const req = new NextRequest("http://localhost/api/features/board");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/workspaceId/);
  });

  it("returns 403 when the caller is an authenticated non-member", async () => {
    // `resolveWorkspaceAccess` returns kind: "forbidden" for authenticated
    // callers who aren't members of a non-public workspace;
    // `requireReadAccess` surfaces that as 403 "Access denied".
    mockedResolveWorkspaceAccess.mockResolvedValue({ kind: "forbidden" });
    const req = makeRequest({ workspaceId: "ws-1" });
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    // `resolveWorkspaceAccess` returns kind: "unauthenticated" for callers
    // with no session on a non-public workspace; `requireReadAccess`
    // surfaces that as 401 "Unauthorized".
    mockedResolveWorkspaceAccess.mockResolvedValue({ kind: "unauthenticated" });
    const req = makeRequest({ workspaceId: "ws-1" });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid status values", async () => {
    const req = makeRequest({ workspaceId: "ws-1", status: "INVALID_STATUS" });
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid status/);
  });

  it("returns features with tasks successfully", async () => {
    dbMock.feature.findMany.mockResolvedValue([baseFeature]);
    const req = makeRequest({ workspaceId: "ws-1" });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("feature-1");
    expect(body.data[0].tasks).toHaveLength(1);
    expect(body.data[0].tasks[0].id).toBe("task-1");
  });

  it("excludes CANCELLED features by default", async () => {
    dbMock.feature.findMany.mockResolvedValue([]);
    const req = makeRequest({ workspaceId: "ws-1" });
    await GET(req);
    expect(dbMock.feature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: expect.objectContaining({
            in: expect.not.arrayContaining([FeatureStatus.CANCELLED]),
          }),
        }),
      }),
    );
  });

  it("includes CANCELLED when explicitly requested in status param", async () => {
    dbMock.feature.findMany.mockResolvedValue([]);
    const req = makeRequest({ workspaceId: "ws-1", status: "CANCELLED" });
    await GET(req);
    expect(dbMock.feature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [FeatureStatus.CANCELLED] },
        }),
      }),
    );
  });

  it("respects comma-separated status filter", async () => {
    dbMock.feature.findMany.mockResolvedValue([]);
    const req = makeRequest({
      workspaceId: "ws-1",
      status: "BACKLOG,PLANNED",
    });
    await GET(req);
    expect(dbMock.feature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [FeatureStatus.BACKLOG, FeatureStatus.PLANNED] },
        }),
      }),
    );
  });

  it("excludes deleted features and deleted/archived tasks", async () => {
    dbMock.feature.findMany.mockResolvedValue([]);
    const req = makeRequest({ workspaceId: "ws-1" });
    await GET(req);

    const call = dbMock.feature.findMany.mock.calls[0][0];
    expect(call.where.deleted).toBe(false);
    expect(call.select.tasks.where.deleted).toBe(false);
    expect(call.select.tasks.where.archived).toBe(false);
  });

  it("includes dependsOnTaskIds in task select", async () => {
    dbMock.feature.findMany.mockResolvedValue([]);
    const req = makeRequest({ workspaceId: "ws-1" });
    await GET(req);

    const call = dbMock.feature.findMany.mock.calls[0][0];
    expect(call.select.tasks.select.dependsOnTaskIds).toBe(true);
  });

  it("returns task with assignee data", async () => {
    const featureWithAssignee = {
      ...baseFeature,
      tasks: [
        {
          ...baseTask,
          assignee: { id: "u-1", name: "Alice", email: "alice@x.com", image: null },
        },
      ],
    };
    dbMock.feature.findMany.mockResolvedValue([featureWithAssignee]);
    const req = makeRequest({ workspaceId: "ws-1" });
    const res = await GET(req);
    const body = await res.json();
    expect(body.data[0].tasks[0].assignee?.name).toBe("Alice");
  });

  it("returns empty array when no features match", async () => {
    dbMock.feature.findMany.mockResolvedValue([]);
    const req = makeRequest({ workspaceId: "ws-1" });
    const res = await GET(req);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("returns features with zero tasks (empty group)", async () => {
    const emptyFeature = { ...baseFeature, tasks: [] };
    dbMock.feature.findMany.mockResolvedValue([emptyFeature]);
    const req = makeRequest({ workspaceId: "ws-1" });
    const res = await GET(req);
    const body = await res.json();
    expect(body.data[0].tasks).toEqual([]);
  });
});
