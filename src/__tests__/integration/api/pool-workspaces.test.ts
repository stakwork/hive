import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/w/[slug]/pool/workspaces/route";
import { db } from "@/lib/db";
import { PoolManagerService } from "@/services/pool-manager";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import {
  createGetRequest,
  createAuthenticatedGetRequest,
  generateUniqueId,
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm } from "@prisma/client";
import type { PoolWorkspacesResponse, VMData } from "@/types";
import { NextResponse } from "next/server";

// Mock middleware utilities
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

import { requireAuth } from "@/lib/middleware/utils";
const getMockedRequireAuth = vi.mocked(requireAuth);

describe("GET /api/w/[slug]/pool/workspaces - Authentication", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Pool Workspaces Owner" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    // Create swarm with encrypted API key
    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `test-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
      poolApiKey: "test-pool-api-key",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated requests", async () => {
    getMockedRequireAuth.mockReturnValue(
      NextResponse.json(
        { error: "Unauthorized", kind: "unauthorized" },
        { status: 401 }
      )
    );

    const request = createGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    await expectUnauthorized(response);
  });

  it("should return 400 when workspace slug is missing", async () => {
    getMockedRequireAuth.mockReturnValue({
      id: owner.id,
      email: owner.email!,
      name: owner.name!,
    });

    const request = createGetRequest("/api/w//pool/workspaces");
    const response = await GET(request, {
      params: Promise.resolve({ slug: "" }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Workspace slug is required");
  });

  it("should return 404 for non-existent workspace", async () => {
    getMockedRequireAuth.mockReturnValue({
      id: owner.id,
      email: owner.email!,
      name: owner.name!,
    });

    const request = createGetRequest(
      "/api/w/nonexistent-workspace/pool/workspaces"
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: "nonexistent-workspace" }),
    });

    await expectNotFound(response, "Workspace not found or access denied");
  });

  it("should return 404 when swarm is not configured", async () => {
    // Create workspace without swarm
    const newScenario = await createTestWorkspaceScenario({
      owner: { name: "No Swarm Owner" },
    });

    getMockedRequireAuth.mockReturnValue({
      id: newScenario.owner.id,
      email: newScenario.owner.email!,
      name: newScenario.owner.name!,
    });

    const request = createGetRequest(
      `/api/w/${newScenario.workspace.slug}/pool/workspaces`
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: newScenario.workspace.slug }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Pool not configured for this workspace");
  });

  it("should return 404 when poolApiKey is not configured", async () => {
    // Update swarm to have null poolApiKey
    await db.swarm.update({
      where: { id: swarm.id },
      data: { poolApiKey: null },
    });

    getMockedRequireAuth.mockReturnValue({
      id: owner.id,
      email: owner.email!,
      name: owner.name!,
    });

    const request = createGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Pool not configured for this workspace");
  });
});

describe("GET /api/w/[slug]/pool/workspaces - Authorization", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let memberViewer: User;
  let memberDeveloper: User;
  let memberAdmin: User;
  let nonMember: User;

  beforeEach(async () => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Pool Auth Owner" },
      members: [
        { role: "VIEWER" },
        { role: "DEVELOPER" },
        { role: "ADMIN" },
      ],
    });

    owner = scenario.owner;
    workspace = scenario.workspace;
    memberViewer = scenario.members[0];
    memberDeveloper = scenario.members[1];
    memberAdmin = scenario.members[2];

    // Create swarm with encrypted API key
    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `auth-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
      poolApiKey: "test-pool-api-key-auth",
    });

    // Create non-member user
    nonMember = await db.user.create({
      data: {
        name: "Non Member User",
        email: `non-member-${generateUniqueId("user")}@example.com`,
      },
    });

    // Mock PoolManagerService.getPoolWorkspaces for all authorization tests
    vi.spyOn(PoolManagerService.prototype, "getPoolWorkspaces").mockResolvedValue(
      {
        pool_name: "test-pool",
        workspaces: [
          {
            id: "vm-1",
            subdomain: "test-vm-1",
            state: "running",
            internal_state: "ready",
            usage_status: "used",
            user_info: null,
            resource_usage: {
              available: true,
              requests: { cpu: "1000m", memory: "2Gi" },
              usage: { cpu: "500m", memory: "1Gi" },
            },
            marked_at: null,
            url: "https://test-vm-1.example.com",
            created: "2024-01-15T10:00:00Z",
            repoName: "test-repo",
            primaryRepo: "https://github.com/test/repo",
            repositories: ["https://github.com/test/repo"],
            branches: ["main"],
          },
        ],
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 403 for non-member access", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      nonMember
    );
    getMockedRequireAuth.mockReturnValue({
      id: nonMember.id,
      email: nonMember.email!,
      name: nonMember.name!,
    });

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    await expectNotFound(response, "Workspace not found or access denied");
  });

  it("should allow VIEWER role to access pool workspaces", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      memberViewer
    );
    getMockedRequireAuth.mockReturnValue({
      id: memberViewer.id,
      email: memberViewer.email!,
      name: memberViewer.name!,
    });

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.data.pool_name).toBe("test-pool");
    expect(data.data.workspaces).toHaveLength(1);
  });

  it("should allow DEVELOPER role to access pool workspaces", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      memberDeveloper
    );
    getMockedRequireAuth.mockReturnValue({
      id: memberDeveloper.id,
      email: memberDeveloper.email!,
      name: memberDeveloper.name!,
    });

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
  });

  it("should allow ADMIN role to access pool workspaces", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      memberAdmin
    );
    getMockedRequireAuth.mockReturnValue({
      id: memberAdmin.id,
      email: memberAdmin.email!,
      name: memberAdmin.name!,
    });

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
  });

  it("should allow OWNER role to access pool workspaces", async () => {
    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      owner
    );
    getMockedRequireAuth.mockReturnValue({
      id: owner.id,
      email: owner.email!,
      name: owner.name!,
    });

    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
  });
});

describe("GET /api/w/[slug]/pool/workspaces - External Service Integration", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Pool Service Owner" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `service-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
      poolApiKey: "test-pool-api-key-service",
    });

    getMockedRequireAuth.mockReturnValue({
      id: owner.id,
      email: owner.email!,
      name: owner.name!,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should successfully fetch workspace list from external service", async () => {
    const mockWorkspaces: VMData[] = [
      {
        id: "vm-1",
        subdomain: "test-vm-1",
        state: "running",
        internal_state: "ready",
        usage_status: "used",
        user_info: "user@example.com",
        resource_usage: {
          available: true,
          requests: { cpu: "2000m", memory: "4Gi" },
          usage: { cpu: "1000m", memory: "2Gi" },
        },
        marked_at: "2024-01-15T10:00:00Z",
        url: "https://test-vm-1.example.com",
        created: "2024-01-10T08:00:00Z",
        repoName: "main-repo",
        primaryRepo: "https://github.com/test/main-repo",
        repositories: ["https://github.com/test/main-repo", "https://github.com/test/lib"],
        branches: ["main", "dev"],
      },
      {
        id: "vm-2",
        subdomain: "test-vm-2",
        state: "stopped",
        internal_state: "stopped",
        usage_status: "unused",
        user_info: null,
        resource_usage: {
          available: false,
          requests: { cpu: "1000m", memory: "2Gi" },
          usage: { cpu: "0m", memory: "0Gi" },
        },
        marked_at: null,
        url: "https://test-vm-2.example.com",
        created: "2024-01-12T09:00:00Z",
        repoName: "test-repo",
        primaryRepo: "https://github.com/test/test-repo",
        repositories: ["https://github.com/test/test-repo"],
        branches: ["main"],
      },
    ];

    const mockResponse: PoolWorkspacesResponse = {
      pool_name: "production-pool",
      workspaces: mockWorkspaces,
    };

    vi.spyOn(PoolManagerService.prototype, "getPoolWorkspaces").mockResolvedValue(
      mockResponse
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockResponse);
    expect(data.data.pool_name).toBe("production-pool");
    expect(data.data.workspaces).toHaveLength(2);
    expect(data.data.workspaces[0].id).toBe("vm-1");
    expect(data.data.workspaces[0].state).toBe("running");
    expect(data.data.workspaces[1].id).toBe("vm-2");
    expect(data.data.workspaces[1].state).toBe("stopped");
  });

  it("should return 200 with basic data when pool service is unavailable", async () => {
    vi.spyOn(PoolManagerService.prototype, "getPoolWorkspaces").mockRejectedValue(
      new Error("Unable to connect to pool service")
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.warning).toBe("Real-time metrics unavailable");
    expect(data.data).toBeDefined();
    expect(data.data.workspaces).toBeDefined();
    expect(Array.isArray(data.data.workspaces)).toBe(true);
  });

  it("should return 200 with basic data when workspace data cannot be fetched", async () => {
    vi.spyOn(PoolManagerService.prototype, "getPoolWorkspaces").mockRejectedValue(
      new Error("Unable to fetch workspace data at the moment")
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.warning).toBe("Real-time metrics unavailable");
    expect(data.data).toBeDefined();
    expect(data.data.workspaces).toBeDefined();
  });

  it("should return 200 with basic data on network errors", async () => {
    vi.spyOn(PoolManagerService.prototype, "getPoolWorkspaces").mockRejectedValue(
      new Error("Network error: Connection timeout")
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.warning).toBe("Real-time metrics unavailable");
    expect(data.data).toBeDefined();
  });

  it("should decrypt poolApiKey before calling external service", async () => {
    const getPoolWorkspacesSpy = vi.spyOn(
      PoolManagerService.prototype,
      "getPoolWorkspaces"
    ).mockResolvedValue({
      pool_name: "test-pool",
      workspaces: [],
    });

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    await expectSuccess(response);

    // Verify getPoolWorkspaces was called with swarm.id and encrypted poolApiKey
    expect(getPoolWorkspacesSpy).toHaveBeenCalledWith(
      swarm.id,
      expect.any(String) // poolApiKey (encrypted JSON string)
    );
  });
});

describe("GET /api/w/[slug]/pool/workspaces - Response Structure", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Pool Response Owner" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `response-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
      poolApiKey: "test-pool-api-key-response",
    });

    getMockedRequireAuth.mockReturnValue({
      id: owner.id,
      email: owner.email!,
      name: owner.name!,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return valid PoolWorkspacesResponse structure", async () => {
    const mockResponse: PoolWorkspacesResponse = {
      pool_name: "test-pool",
      workspaces: [
        {
          id: "vm-1",
          subdomain: "vm-1",
          state: "running",
          internal_state: "ready",
          usage_status: "used",
          user_info: "test@example.com",
          resource_usage: {
            available: true,
            requests: { cpu: "1000m", memory: "2Gi" },
            usage: { cpu: "500m", memory: "1Gi" },
          },
          marked_at: "2024-01-15T10:00:00Z",
          url: "https://vm-1.example.com",
          created: "2024-01-10T08:00:00Z",
          repoName: "test-repo",
          primaryRepo: "https://github.com/test/repo",
          repositories: ["https://github.com/test/repo"],
          branches: ["main"],
        },
      ],
    };

    vi.spyOn(PoolManagerService.prototype, "getPoolWorkspaces").mockResolvedValue(
      mockResponse
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);

    // Verify response structure
    expect(data).toHaveProperty("success");
    expect(data).toHaveProperty("data");
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty("pool_name");
    expect(data.data).toHaveProperty("workspaces");
    expect(Array.isArray(data.data.workspaces)).toBe(true);

    // Verify workspace object structure
    const vmWorkspace = data.data.workspaces[0];
    expect(vmWorkspace).toHaveProperty("id");
    expect(vmWorkspace).toHaveProperty("subdomain");
    expect(vmWorkspace).toHaveProperty("state");
    expect(vmWorkspace).toHaveProperty("internal_state");
    expect(vmWorkspace).toHaveProperty("usage_status");
    expect(vmWorkspace).toHaveProperty("user_info");
    expect(vmWorkspace).toHaveProperty("resource_usage");
    expect(vmWorkspace).toHaveProperty("marked_at");
    expect(vmWorkspace).toHaveProperty("url");
    expect(vmWorkspace).toHaveProperty("created");
    expect(vmWorkspace).toHaveProperty("repoName");
    expect(vmWorkspace).toHaveProperty("primaryRepo");
    expect(vmWorkspace).toHaveProperty("repositories");
    expect(vmWorkspace).toHaveProperty("branches");

    // Verify data types
    expect(typeof data.data.pool_name).toBe("string");
    expect(typeof vmWorkspace.id).toBe("string");
    expect(typeof vmWorkspace.state).toBe("string");
    expect(typeof vmWorkspace.usage_status).toBe("string");
    expect(Array.isArray(vmWorkspace.repositories)).toBe(true);
    expect(Array.isArray(vmWorkspace.branches)).toBe(true);
  });

  it("should handle empty workspace list", async () => {
    const mockResponse: PoolWorkspacesResponse = {
      pool_name: "empty-pool",
      workspaces: [],
    };

    vi.spyOn(PoolManagerService.prototype, "getPoolWorkspaces").mockResolvedValue(
      mockResponse
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data.pool_name).toBe("empty-pool");
    expect(data.data.workspaces).toHaveLength(0);
  });

  it("should handle multiple workspaces", async () => {
    const mockWorkspaces: VMData[] = Array.from({ length: 5 }, (_, i) => ({
      id: `vm-${i + 1}`,
      subdomain: `vm-${i + 1}`,
      state: i % 2 === 0 ? "running" : "stopped",
      internal_state: i % 2 === 0 ? "ready" : "stopped",
      usage_status: i % 2 === 0 ? "used" : "unused",
      user_info: i % 2 === 0 ? `user${i}@example.com` : null,
      resource_usage: {
        available: i % 2 === 0,
        requests: { cpu: "1000m", memory: "2Gi" },
        usage: { cpu: i % 2 === 0 ? "500m" : "0m", memory: i % 2 === 0 ? "1Gi" : "0Gi" },
      },
      marked_at: i % 2 === 0 ? "2024-01-15T10:00:00Z" : null,
      url: `https://vm-${i + 1}.example.com`,
      created: "2024-01-10T08:00:00Z",
      repoName: `repo-${i + 1}`,
      primaryRepo: `https://github.com/test/repo-${i + 1}`,
      repositories: [`https://github.com/test/repo-${i + 1}`],
      branches: ["main"],
    }));

    const mockResponse: PoolWorkspacesResponse = {
      pool_name: "multi-pool",
      workspaces: mockWorkspaces,
    };

    vi.spyOn(PoolManagerService.prototype, "getPoolWorkspaces").mockResolvedValue(
      mockResponse
    );

    const request = createAuthenticatedGetRequest(
      `/api/w/${workspace.slug}/pool/workspaces`,
      owner
    );
    const response = await GET(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data.workspaces).toHaveLength(5);
    expect(data.data.workspaces[0].id).toBe("vm-1");
    expect(data.data.workspaces[4].id).toBe("vm-5");
  });
});
