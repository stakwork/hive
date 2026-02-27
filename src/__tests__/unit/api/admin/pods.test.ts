import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { PodUsageStatus } from "@prisma/client";

// Mock dependencies
vi.mock("@/lib/auth/require-superadmin");
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findMany: vi.fn(),
    },
  },
}));

// Import after mocks
import { GET } from "@/app/api/admin/pods/route";
import { requireSuperAdmin } from "@/lib/auth/require-superadmin";
import { db } from "@/lib/db";

describe("GET /api/admin/pods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 403 when requireSuperAdmin rejects", async () => {
    const forbiddenResponse = NextResponse.json(
      { error: "Forbidden" },
      { status: 403 }
    );
    vi.mocked(requireSuperAdmin).mockResolvedValueOnce(forbiddenResponse);

    const request = new NextRequest("http://localhost:3000/api/admin/pods");
    const response = await GET(request);

    expect(response.status).toBe(403);
  });

  it("returns correct usedVms and totalPods per workspace", async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValueOnce({ userId: "test-user-id" });

    const mockWorkspaces = [
      {
        id: "ws1",
        swarm: {
          pods: [
            { usageStatus: PodUsageStatus.USED, deletedAt: null },
            { usageStatus: PodUsageStatus.USED, deletedAt: null },
            { usageStatus: PodUsageStatus.UNUSED, deletedAt: null },
            { usageStatus: PodUsageStatus.UNUSED, deletedAt: null },
            { usageStatus: PodUsageStatus.UNUSED, deletedAt: null },
          ],
        },
      },
      {
        id: "ws2",
        swarm: {
          pods: [
            { usageStatus: PodUsageStatus.USED, deletedAt: null },
            { usageStatus: PodUsageStatus.UNUSED, deletedAt: null },
          ],
        },
      },
    ];

    vi.mocked(db.workspace.findMany).mockResolvedValueOnce(mockWorkspaces as any);

    const request = new NextRequest("http://localhost:3000/api/admin/pods");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.workspaces).toHaveLength(2);
    expect(data.workspaces[0]).toEqual({
      workspaceId: "ws1",
      usedVms: 2,
      totalPods: 5,
    });
    expect(data.workspaces[1]).toEqual({
      workspaceId: "ws2",
      usedVms: 1,
      totalPods: 2,
    });
  });

  it("returns usedVms: 0, totalPods: 0 for workspace with no swarm", async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValueOnce({ userId: "test-user-id" });

    const mockWorkspaces = [
      {
        id: "ws1",
        swarm: null,
      },
      {
        id: "ws2",
        swarm: {
          pods: [{ usageStatus: PodUsageStatus.USED, deletedAt: null }],
        },
      },
    ];

    vi.mocked(db.workspace.findMany).mockResolvedValueOnce(mockWorkspaces as any);

    const request = new NextRequest("http://localhost:3000/api/admin/pods");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.workspaces).toHaveLength(2);
    expect(data.workspaces[0]).toEqual({
      workspaceId: "ws1",
      usedVms: 0,
      totalPods: 0,
    });
    expect(data.workspaces[1]).toEqual({
      workspaceId: "ws2",
      usedVms: 1,
      totalPods: 1,
    });
  });

  it("returns 200 with empty workspaces array when no workspaces exist", async () => {
    vi.mocked(requireSuperAdmin).mockResolvedValueOnce({ userId: "test-user-id" });
    vi.mocked(db.workspace.findMany).mockResolvedValueOnce([]);

    const request = new NextRequest("http://localhost:3000/api/admin/pods");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();

    expect(data.workspaces).toEqual([]);
  });
});
