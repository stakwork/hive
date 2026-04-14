import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies BEFORE importing the route
vi.mock("@/services/workspace", () => ({
  getWorkspaceBySlug: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/service-factory", () => ({
  poolManagerService: vi.fn(),
}));

vi.mock("@/lib/pods/queries", () => ({
  softDeletePodByPodId: vi.fn(),
}));

// Import after mocks
import { DELETE } from "@/app/api/w/[slug]/pool/workspaces/[workspaceId]/route";
import { getWorkspaceBySlug } from "@/services/workspace";
import { db } from "@/lib/db";
import { poolManagerService } from "@/lib/service-factory";
import { softDeletePodByPodId } from "@/lib/pods/queries";
import { addMiddlewareHeaders } from "@/__tests__/support/helpers/request-builders";
import { NextRequest } from "next/server";

const mockUser = { id: "user-1", email: "owner@test.com", name: "Owner" };

const mockWorkspace = {
  id: "workspace-1",
  slug: "test-slug",
  userRole: "OWNER",
};

const mockSwarm = {
  id: "swarm-1",
  poolApiKey: "test-pool-api-key",
};

const mockDeletePodFromPool = vi.fn();

function createDeleteRequest(slug: string, podId: string) {
  const base = new NextRequest(`http://localhost/api/w/${slug}/pool/workspaces/${podId}`, {
    method: "DELETE",
  });
  return addMiddlewareHeaders(base, mockUser);
}

describe("DELETE /api/w/[slug]/pool/workspaces/[workspaceId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getWorkspaceBySlug).mockResolvedValue(mockWorkspace as any);
    vi.mocked(db.swarm.findFirst).mockResolvedValue(mockSwarm as any);
    vi.mocked(poolManagerService).mockReturnValue({
      deletePodFromPool: mockDeletePodFromPool,
    } as any);
    mockDeletePodFromPool.mockResolvedValue({ success: true });
    vi.mocked(softDeletePodByPodId).mockResolvedValue(undefined);

    // Default: transaction succeeds and clears 1 task
    vi.mocked(db.$transaction).mockImplementation(async (fn) => {
      return fn({
        $queryRaw: vi.fn().mockResolvedValue([]),
        task: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      } as any);
    });
  });

  it("should return { success: true } after deleting pod", async () => {
    const request = createDeleteRequest("test-slug", "pod-1");
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: "test-slug", workspaceId: "pod-1" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  it("should call deletePodFromPool with correct args", async () => {
    const request = createDeleteRequest("test-slug", "pod-1");
    await DELETE(request, {
      params: Promise.resolve({ slug: "test-slug", workspaceId: "pod-1" }),
    });

    expect(mockDeletePodFromPool).toHaveBeenCalledWith("swarm-1", "pod-1", "test-pool-api-key");
  });

  it("should call db.$transaction to atomically clear task pod refs", async () => {
    const mockUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const mockTx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      task: { updateMany: mockUpdateMany },
    };
    vi.mocked(db.$transaction).mockImplementation(async (fn) => fn(mockTx as any));

    const request = createDeleteRequest("test-slug", "pod-1");
    await DELETE(request, {
      params: Promise.resolve({ slug: "test-slug", workspaceId: "pod-1" }),
    });

    expect(db.$transaction).toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { podId: "pod-1" },
      data: { podId: null, agentPassword: null, agentUrl: null },
    });
  });

  it("should still return { success: true } when db.$transaction throws (best-effort)", async () => {
    vi.mocked(db.$transaction).mockRejectedValue(new Error("Transaction failed"));

    const request = createDeleteRequest("test-slug", "pod-1");
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: "test-slug", workspaceId: "pod-1" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  it("should return 403 when user is not OWNER or ADMIN", async () => {
    vi.mocked(getWorkspaceBySlug).mockResolvedValue({
      ...mockWorkspace,
      userRole: "DEVELOPER",
    } as any);

    const request = createDeleteRequest("test-slug", "pod-1");
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: "test-slug", workspaceId: "pod-1" }),
    });

    expect(response.status).toBe(403);
  });

  it("should return 404 when workspace not found", async () => {
    vi.mocked(getWorkspaceBySlug).mockResolvedValue(null);

    const request = createDeleteRequest("test-slug", "pod-1");
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: "test-slug", workspaceId: "pod-1" }),
    });

    expect(response.status).toBe(404);
  });

  it("should return 404 when swarm has no poolApiKey", async () => {
    vi.mocked(db.swarm.findFirst).mockResolvedValue({ id: "swarm-1", poolApiKey: null } as any);

    const request = createDeleteRequest("test-slug", "pod-1");
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: "test-slug", workspaceId: "pod-1" }),
    });

    expect(response.status).toBe(404);
  });

  it("should call softDeletePodByPodId before deletePodFromPool", async () => {
    const callOrder: string[] = [];
    vi.mocked(softDeletePodByPodId).mockImplementation(async () => {
      callOrder.push("softDelete");
    });
    mockDeletePodFromPool.mockImplementation(async () => {
      callOrder.push("deleteFromPool");
      return { success: true };
    });

    const request = createDeleteRequest("test-slug", "pod-1");
    await DELETE(request, {
      params: Promise.resolve({ slug: "test-slug", workspaceId: "pod-1" }),
    });

    expect(callOrder).toEqual(["softDelete", "deleteFromPool"]);
    expect(softDeletePodByPodId).toHaveBeenCalledWith("pod-1");
  });

  it("should return 500 and NOT call deletePodFromPool if softDeletePodByPodId throws", async () => {
    vi.mocked(softDeletePodByPodId).mockRejectedValue(new Error("DB write failed"));

    const request = createDeleteRequest("test-slug", "pod-1");
    const response = await DELETE(request, {
      params: Promise.resolve({ slug: "test-slug", workspaceId: "pod-1" }),
    });

    expect(response.status).toBe(500);
    expect(mockDeletePodFromPool).not.toHaveBeenCalled();
  });

  it("should call softDeletePodByPodId with the correct workspaceId", async () => {
    const request = createDeleteRequest("test-slug", "my-pod-id");
    await DELETE(request, {
      params: Promise.resolve({ slug: "test-slug", workspaceId: "my-pod-id" }),
    });

    expect(softDeletePodByPodId).toHaveBeenCalledWith("my-pod-id");
  });
});
