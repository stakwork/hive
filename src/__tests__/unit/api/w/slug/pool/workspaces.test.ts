import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Mock dependencies BEFORE importing the route
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  getWorkspaceBySlug: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(() => ({
    baseURL: "https://test-pool-manager.com/api",
    apiKey: "test-api-key",
    headers: {},
  })),
}));

vi.mock("@/services/pool-manager", () => ({
  PoolManagerService: vi.fn(),
}));

// Import after mocks
import { GET } from "@/app/api/w/[slug]/pool/workspaces/route";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceBySlug } from "@/services/workspace";
import { PoolManagerService } from "@/services/pool-manager";
import { db } from "@/lib/db";

describe("GET /api/w/[slug]/pool/workspaces", () => {
  const mockUser = {
    id: "user-123",
    email: "test@example.com",
    name: "Test User",
  };

  const mockWorkspace = {
    id: "ws-123",
    slug: "test-workspace",
    name: "Test Workspace",
    ownerId: mockUser.id,
  };

  const mockSwarm = {
    id: "swarm-123",
    poolApiKey: JSON.stringify({
      data: "encrypted-api-key",
      iv: "test-iv",
      tag: "test-tag",
      version: "1",
      encryptedAt: new Date().toISOString(),
    }),
    workspaceId: mockWorkspace.id,
  };

  const mockPoolWorkspaces = {
    pool_name: "test-pool",
    workspaces: [
      {
        id: "vm-1",
        subdomain: "vm-1.test.com",
        state: "running",
        internal_state: "active",
        usage_status: "in-use",
        user_info: {
          id: mockUser.id,
          email: mockUser.email,
        },
        resource_usage: {
          cpu: "50%",
          memory: "2GB",
        },
        marked_at: new Date().toISOString(),
        url: "https://vm-1.test.com",
        created: new Date().toISOString(),
        repoName: "test-repo",
        primaryRepo: "main",
        repositories: ["repo1", "repo2"],
        branches: ["main", "dev"],
      },
      {
        id: "vm-2",
        subdomain: "vm-2.test.com",
        state: "idle",
        internal_state: "ready",
        usage_status: "available",
        user_info: null,
        resource_usage: {
          cpu: "10%",
          memory: "512MB",
        },
        marked_at: null,
        url: "https://vm-2.test.com",
        created: new Date().toISOString(),
        repoName: null,
        primaryRepo: null,
        repositories: [],
        branches: [],
      },
    ],
  };

  let mockRequest: NextRequest;
  let mockPoolManagerService: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup default mock request
    mockRequest = new NextRequest("http://localhost:3000/api/w/test-workspace/pool/workspaces");

    // Setup default mock implementations
    vi.mocked(getMiddlewareContext).mockReturnValue({
      requestId: "req-123",
      authStatus: "authenticated",
      user: mockUser,
    });

    vi.mocked(requireAuth).mockReturnValue(mockUser);
    vi.mocked(getWorkspaceBySlug).mockResolvedValue(mockWorkspace as any);
    vi.mocked(db.swarm.findFirst).mockResolvedValue(mockSwarm as any);

    // Setup mock PoolManagerService instance
    mockPoolManagerService = {
      getPoolWorkspaces: vi.fn().mockResolvedValue(mockPoolWorkspaces),
    };

    // Mock PoolManagerService constructor to return our mock instance
    vi.mocked(PoolManagerService).mockImplementation(() => mockPoolManagerService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication & Authorization", () => {
    it("should return 401 when user is not authenticated", async () => {
      const mockResponse = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      vi.mocked(requireAuth).mockReturnValue(mockResponse);

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      expect(response).toBe(mockResponse);
      expect(requireAuth).toHaveBeenCalledWith({
        requestId: "req-123",
        authStatus: "authenticated",
        user: mockUser,
      });
    });

    it("should return 404 when workspace not found", async () => {
      vi.mocked(getWorkspaceBySlug).mockResolvedValue(null);

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "non-existent" }),
      });

      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({
        error: "Workspace not found or access denied",
      });
    });

    it("should return 404 when user does not have access to workspace", async () => {
      vi.mocked(getWorkspaceBySlug).mockResolvedValue(null);

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({
        error: "Workspace not found or access denied",
      });
      expect(getWorkspaceBySlug).toHaveBeenCalledWith("test-workspace", mockUser.id);
    });

    it("should return 400 when slug parameter is missing", async () => {
      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "" }),
      });

      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({
        error: "Workspace slug is required",
      });
    });
  });

  describe("Swarm Configuration", () => {
    it("should return 404 when workspace has no Swarm configured", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue(null);

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({
        success: false,
        message: "Pool not configured for this workspace",
      });
    });

    it("should return 404 when Swarm has no pool ID", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        ...mockSwarm,
        id: null,
      } as any);

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({
        success: false,
        message: "Pool not configured for this workspace",
      });
    });

    it("should return 404 when Swarm has no pool API key", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        ...mockSwarm,
        poolApiKey: null,
      } as any);

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({
        success: false,
        message: "Pool not configured for this workspace",
      });
    });
  });

  describe("Successful Pool Workspaces Retrieval", () => {
    it("should return 200 with pool workspaces data for authenticated user", async () => {
      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        data: mockPoolWorkspaces,
      });
    });

    it("should call PoolManagerService with correct parameters", async () => {
      await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      expect(mockPoolManagerService.getPoolWorkspaces).toHaveBeenCalledWith(
        mockSwarm.id,
        mockSwarm.poolApiKey
      );
    });

    it("should query Swarm with correct workspace ID", async () => {
      await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: {
          workspaceId: mockWorkspace.id,
        },
        select: {
          id: true,
          poolApiKey: true,
        },
      });
    });

    it("should return workspaces with correct data structure", async () => {
      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.data.pool_name).toBe("test-pool");
      expect(data.data.workspaces).toHaveLength(2);
      expect(data.data.workspaces[0]).toMatchObject({
        id: "vm-1",
        subdomain: "vm-1.test.com",
        state: "running",
        usage_status: "in-use",
        resource_usage: {
          cpu: "50%",
          memory: "2GB",
        },
      });
    });

    it("should handle empty pool workspaces array", async () => {
      mockPoolManagerService.getPoolWorkspaces.mockResolvedValue({
        pool_name: "test-pool",
        workspaces: [],
      });

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.workspaces).toEqual([]);
    });
  });

  describe("Pool Manager Service Integration", () => {
    it("should return 503 when Pool Manager service is unavailable", async () => {
      mockPoolManagerService.getPoolWorkspaces.mockRejectedValue(
        new Error("Unable to connect to pool service")
      );

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data).toEqual({
        success: false,
        message: "Unable to connect to pool service",
      });
    });

    it("should return 503 when Pool Manager returns error", async () => {
      mockPoolManagerService.getPoolWorkspaces.mockRejectedValue(
        new Error("Unable to fetch workspace data at the moment")
      );

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data).toEqual({
        success: false,
        message: "Unable to fetch workspace data at the moment",
      });
    });

    it("should handle generic errors from Pool Manager service", async () => {
      mockPoolManagerService.getPoolWorkspaces.mockRejectedValue(
        new Error("Network timeout")
      );

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Network timeout");
    });

    it("should handle non-Error exceptions from Pool Manager", async () => {
      mockPoolManagerService.getPoolWorkspaces.mockRejectedValue("String error");

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data).toEqual({
        success: false,
        message: "Unable to fetch workspace data right now",
      });
    });
  });

  describe("Data Transformation", () => {
    it("should correctly transform VM data with all fields present", async () => {
      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();
      const vm = data.data.workspaces[0];

      expect(vm).toHaveProperty("id");
      expect(vm).toHaveProperty("subdomain");
      expect(vm).toHaveProperty("state");
      expect(vm).toHaveProperty("internal_state");
      expect(vm).toHaveProperty("usage_status");
      expect(vm).toHaveProperty("user_info");
      expect(vm).toHaveProperty("resource_usage");
      expect(vm).toHaveProperty("marked_at");
      expect(vm).toHaveProperty("url");
      expect(vm).toHaveProperty("created");
      expect(vm).toHaveProperty("repoName");
      expect(vm).toHaveProperty("primaryRepo");
      expect(vm).toHaveProperty("repositories");
      expect(vm).toHaveProperty("branches");
    });

    it("should handle VMs with null optional fields", async () => {
      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();
      const vm = data.data.workspaces[1];

      expect(vm.user_info).toBeNull();
      expect(vm.marked_at).toBeNull();
      expect(vm.repoName).toBeNull();
      expect(vm.primaryRepo).toBeNull();
      expect(vm.repositories).toEqual([]);
      expect(vm.branches).toEqual([]);
    });

    it("should preserve resource usage data structure", async () => {
      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();
      const vm = data.data.workspaces[0];

      expect(vm.resource_usage).toEqual({
        cpu: "50%",
        memory: "2GB",
      });
    });

    it("should preserve user info when present", async () => {
      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();
      const vm = data.data.workspaces[0];

      expect(vm.user_info).toEqual({
        id: mockUser.id,
        email: mockUser.email,
      });
    });
  });

  describe("Error Handling", () => {
    it("should return 500 for unexpected errors during processing", async () => {
      vi.mocked(getWorkspaceBySlug).mockRejectedValue(
        new Error("Database connection failed")
      );

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        success: false,
        message: "Database connection failed",
      });
    });

    it("should handle database query failures gracefully", async () => {
      vi.mocked(db.swarm.findFirst).mockRejectedValue(
        new Error("Query timeout")
      );

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Query timeout");
    });

    it("should handle malformed middleware context", async () => {
      vi.mocked(getMiddlewareContext).mockReturnValue({
        requestId: "req-123",
        authStatus: "error",
      });

      const mockResponse = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      vi.mocked(requireAuth).mockReturnValue(mockResponse);

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      expect(response).toBe(mockResponse);
    });
  });

  describe("Workspace Access Control", () => {
    it("should allow workspace owner to access pool workspaces", async () => {
      const ownerWorkspace = {
        ...mockWorkspace,
        ownerId: mockUser.id,
      };

      vi.mocked(getWorkspaceBySlug).mockResolvedValue(ownerWorkspace as any);

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      expect(response.status).toBe(200);
    });

    it("should allow workspace member to access pool workspaces", async () => {
      const memberWorkspace = {
        ...mockWorkspace,
        ownerId: "different-owner-id",
      };

      vi.mocked(getWorkspaceBySlug).mockResolvedValue(memberWorkspace as any);

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      expect(response.status).toBe(200);
    });
  });

  describe("Response Structure Validation", () => {
    it("should return response with correct success wrapper structure", async () => {
      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("data");
      expect(data.success).toBe(true);
    });

    it("should return pool_name in response data", async () => {
      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(data.data).toHaveProperty("pool_name");
      expect(typeof data.data.pool_name).toBe("string");
    });

    it("should return workspaces array in response data", async () => {
      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(data.data).toHaveProperty("workspaces");
      expect(Array.isArray(data.data.workspaces)).toBe(true);
    });

    it("should return error structure for failure cases", async () => {
      vi.mocked(getWorkspaceBySlug).mockResolvedValue(null);

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(data).toHaveProperty("error");
      expect(data).not.toHaveProperty("data");
    });
  });

  describe("Pool State Filtering", () => {
    it("should return all VMs regardless of state", async () => {
      const mixedStateWorkspaces = {
        pool_name: "test-pool",
        workspaces: [
          { ...mockPoolWorkspaces.workspaces[0], state: "running" },
          { ...mockPoolWorkspaces.workspaces[1], state: "idle" },
          { ...mockPoolWorkspaces.workspaces[0], id: "vm-3", state: "pending" },
          { ...mockPoolWorkspaces.workspaces[0], id: "vm-4", state: "failed" },
        ],
      };

      mockPoolManagerService.getPoolWorkspaces.mockResolvedValue(mixedStateWorkspaces);

      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(data.data.workspaces).toHaveLength(4);
      expect(data.data.workspaces.map((vm: any) => vm.state)).toEqual([
        "running",
        "idle",
        "pending",
        "failed",
      ]);
    });

    it("should preserve usage_status for each VM", async () => {
      const response = await GET(mockRequest, {
        params: Promise.resolve({ slug: "test-workspace" }),
      });

      const data = await response.json();

      expect(data.data.workspaces[0].usage_status).toBe("in-use");
      expect(data.data.workspaces[1].usage_status).toBe("available");
    });
  });
});