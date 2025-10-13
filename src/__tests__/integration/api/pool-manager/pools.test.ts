import { describe, test, beforeEach, afterEach, vi, expect } from "vitest";
import { POST as CREATE_POOL } from "@/app/api/pool-manager/create-pool/route";
import { DELETE as DELETE_POOL } from "@/app/api/pool-manager/delete-pool/route";
import { GET as POOL_STATUS } from "@/app/api/w/[slug]/pool/status/route";
import { POST as CLAIM_POD } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { EncryptionService } from "@/lib/encryption";
import { PoolManagerService } from "@/services/pool-manager";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
  createTestUser,
} from "@/__tests__/support/fixtures";
import {
  createPostRequest,
  createDeleteRequest,
  createGetRequest,
  createAuthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectNotFound,
  expectForbidden,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm, Repository } from "@prisma/client";
import type { PoolStatusResponse, Pool } from "@/types";

vi.mock("next-auth/next");
const getMocked = vi.mocked(getServerSession);

// Mock PoolManagerService methods
const mockCreatePool = vi.fn();
const mockDeletePool = vi.fn();
const mockGetPoolStatus = vi.fn();
const mockCreateUser = vi.fn();

// Mock PoolManagerService class - this catches all import variations
vi.mock("@/services/pool-manager/PoolManagerService", () => {
  return {
    PoolManagerService: vi.fn().mockImplementation(() => ({
      createPool: mockCreatePool,
      deletePool: mockDeletePool,
      getPoolStatus: mockGetPoolStatus,
      createUser: mockCreateUser,
    })),
  };
});

// Mock the service factory
vi.mock("@/lib/service-factory", () => ({
  poolManagerService: () => ({
    createPool: mockCreatePool,
    deletePool: mockDeletePool,
    getPoolStatus: mockGetPoolStatus,
    createUser: mockCreateUser,
  }),
}));

// Mock getGithubUsernameAndPAT
vi.mock("@/lib/auth/nextauth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/nextauth")>();
  return {
    ...actual,
    getGithubUsernameAndPAT: vi.fn().mockResolvedValue({
      username: "test-user",
      token: "test-github-token",
    }),
  };
});

describe("POST /api/pool-manager/create-pool - Authentication & Authorization", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;
  let member: User;
  let nonMember: User;

  beforeEach(async () => {
    vi.clearAllMocks();

    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Create Owner" },
        members: [{ role: "DEVELOPER" }],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      member = scenario.members[0];

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `create-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: JSON.stringify(encryptedApiKey),
          swarmId: swarm.id,
        },
      });

      repository = await tx.repository.create({
        data: {
          workspaceId: workspace.id,
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          name: "test-repo",
        },
      });

      const nonMemberData = await tx.user.create({
        data: {
          name: "Non Member User",
          email: `non-member-${generateUniqueId("user")}@example.com`,
        },
      });
      nonMember = nonMemberData;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns 401 when not authenticated", async () => {
    getMocked.mockResolvedValue(null);

    const request = createPostRequest(
      "http://localhost/api/pool-manager/create-pool",
      {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      }
    );
    const response = await CREATE_POOL(request);

    await expectUnauthorized(response);
    expect(mockCreatePool).not.toHaveBeenCalled();
  });

  test("returns 401 when session has no user email", async () => {
    getMocked.mockResolvedValue({
      user: { id: owner.id, email: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    } as any);

    const request = createPostRequest(
      "http://localhost/api/pool-manager/create-pool",
      {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      }
    );
    const response = await CREATE_POOL(request);

    await expectUnauthorized(response);
    expect(mockCreatePool).not.toHaveBeenCalled();
  });

  test("returns 403 when user is not owner or member", async () => {
    getMocked.mockResolvedValue({
      user: { id: nonMember.id, email: nonMember.email },
      expires: new Date(Date.now() + 86400000).toISOString(),
    });

    const request = createPostRequest(
      "http://localhost/api/pool-manager/create-pool",
      {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      }
    );
    const response = await CREATE_POOL(request);

    await expectForbidden(response, "Access denied");
    expect(mockCreatePool).not.toHaveBeenCalled();
  });

  test("returns 404 when swarm not found", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(owner));

    const request = createPostRequest(
      "http://localhost/api/pool-manager/create-pool",
      {
        swarmId: "nonexistent-swarm-id",
        workspaceId: workspace.id,
        container_files: {},
      }
    );
    const response = await CREATE_POOL(request);

    await expectNotFound(response, "Swarm not found");
    expect(mockCreatePool).not.toHaveBeenCalled();
  });

  test("allows workspace owner to create pool", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(owner));

    const mockPool: Pool = {
      id: "pool-123",
      name: swarm.id,
      owner_id: owner.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "active",
    };

    mockCreatePool.mockResolvedValue(mockPool);

    const containerFiles = {
      devcontainer_json: { content: "test" },
      dockerfile: { content: "test" },
      docker_compose_yml: { content: "test" },
      pm2_config_js: { content: "test" },
    };

    const request = createPostRequest(
      "http://localhost/api/pool-manager/create-pool",
      {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: containerFiles,
      }
    );
    const response = await CREATE_POOL(request);

    const data = await expectSuccess(response, 201);
    expect(data.pool).toBeDefined();
    expect(mockCreatePool).toHaveBeenCalledTimes(1);
  });

  test("allows workspace member to create pool", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(member));

    const mockPool: Pool = {
      id: "pool-456",
      name: swarm.id,
      owner_id: member.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "active",
    };

    mockCreatePool.mockResolvedValue(mockPool);

    const containerFiles = {
      devcontainer_json: { content: "member test" },
      dockerfile: { content: "member test" },
      docker_compose_yml: { content: "member test" },
      pm2_config_js: { content: "member test" },
    };

    const request = createPostRequest(
      "http://localhost/api/pool-manager/create-pool",
      {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: containerFiles,
      }
    );
    const response = await CREATE_POOL(request);

    const data = await expectSuccess(response, 201);
    expect(data.pool).toBeDefined();
    expect(mockCreatePool).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/pool-manager/create-pool - Pool Creation Flow", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;

  beforeEach(async () => {
    vi.clearAllMocks();

    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Flow Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key-flow"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `flow-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: JSON.stringify(encryptedApiKey),
          swarmId: swarm.id,
        },
      });

      repository = await tx.repository.create({
        data: {
          workspaceId: workspace.id,
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          name: "test-repo",
        },
      });
    });

    getMocked.mockResolvedValue(createAuthenticatedSession(owner));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("successfully creates pool with container files", async () => {
    const mockPool: Pool = {
      id: "pool-789",
      name: swarm.id,
      owner_id: owner.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "active",
    };

    mockCreatePool.mockResolvedValue(mockPool);

    const containerFiles = {
      devcontainer_json: { content: "devcontainer config" },
      dockerfile: { content: "FROM node:18" },
      docker_compose_yml: { content: "version: '3'" },
      pm2_config_js: { content: "module.exports = {}" },
    };

    const request = createPostRequest(
      "http://localhost/api/pool-manager/create-pool",
      {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: containerFiles,
      }
    );
    const response = await CREATE_POOL(request);

    const data = await expectSuccess(response, 201);
    expect(data.pool).toEqual(mockPool);
    expect(data.pool.name).toBe(swarm.id);
    expect(data.pool.status).toBe("active");
  });

  test("handles pool creation service errors", async () => {
    const apiError = {
      status: 500,
      service: "pool-manager",
      message: "Pool Manager service unavailable",
    };
    mockCreatePool.mockRejectedValue(apiError);

    const containerFiles = {
      devcontainer_json: { content: "test" },
      dockerfile: { content: "test" },
      docker_compose_yml: { content: "test" },
      pm2_config_js: { content: "test" },
    };

    const request = createPostRequest(
      "http://localhost/api/pool-manager/create-pool",
      {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: containerFiles,
      }
    );
    const response = await CREATE_POOL(request);

    await expectError(response, "Pool Manager service unavailable", 500);
  });

  test("reuses existing container files from database", async () => {
    // Update swarm with existing container files
    const existingFiles = {
      devcontainer_json: { content: "existing devcontainer" },
      dockerfile: { content: "existing dockerfile" },
      docker_compose_yml: { content: "existing compose" },
      pm2_config_js: { content: "existing pm2" },
    };

    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        containerFiles: existingFiles,
      },
    });

    const mockPool: Pool = {
      id: "pool-reuse",
      name: swarm.id,
      owner_id: owner.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "active",
    };

    mockCreatePool.mockResolvedValue(mockPool);

    const newFiles = {
      devcontainer_json: { content: "new devcontainer" },
      dockerfile: { content: "new dockerfile" },
      docker_compose_yml: { content: "new compose" },
      pm2_config_js: { content: "new pm2" },
    };

    const request = createPostRequest(
      "http://localhost/api/pool-manager/create-pool",
      {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: newFiles,
      }
    );
    const response = await CREATE_POOL(request);

    await expectSuccess(response, 201);
    expect(mockCreatePool).toHaveBeenCalledTimes(1);

    // Verify existing files are used (container_files should be existing, not new)
    const callArgs = mockCreatePool.mock.calls[0][0];
    expect(callArgs.container_files).toEqual(existingFiles);
  });
});

describe("DELETE /api/pool-manager/delete-pool - Pool Deletion", () => {
  let user: User;

  beforeEach(async () => {
    vi.clearAllMocks();
    user = await createTestUser();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns 401 when not authenticated", async () => {
    getMocked.mockResolvedValue(null);

    const request = createDeleteRequest(
      "http://localhost/api/pool-manager/delete-pool",
      { name: "test-pool" }
    );
    const response = await DELETE_POOL(request);

    await expectUnauthorized(response);
    expect(mockDeletePool).not.toHaveBeenCalled();
  });

  test("returns 400 when pool name is missing", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(user));

    const request = createDeleteRequest(
      "http://localhost/api/pool-manager/delete-pool",
      {}
    );
    const response = await DELETE_POOL(request);

    await expectError(response, "Missing required field: name", 400);
    expect(mockDeletePool).not.toHaveBeenCalled();
  });

  test("successfully deletes pool", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(user));

    const mockPool: Pool = {
      id: "pool-delete",
      name: "test-pool",
      owner_id: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "deleted",
    };

    mockDeletePool.mockResolvedValue(mockPool);

    const request = createDeleteRequest(
      "http://localhost/api/pool-manager/delete-pool",
      { name: "test-pool" }
    );
    const response = await DELETE_POOL(request);

    const data = await expectSuccess(response, 201);
    expect(data.pool).toEqual(mockPool);
    expect(data.pool.status).toBe("deleted");
    expect(mockDeletePool).toHaveBeenCalledWith({ name: "test-pool" });
    expect(mockDeletePool).toHaveBeenCalledTimes(1);
  });

  test("handles pool not found error", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(user));

    const apiError = {
      status: 404,
      service: "pool-manager",
      message: "Pool not found",
    };
    mockDeletePool.mockRejectedValue(apiError);

    const request = createDeleteRequest(
      "http://localhost/api/pool-manager/delete-pool",
      { name: "nonexistent-pool" }
    );
    const response = await DELETE_POOL(request);

    await expectError(response, "Pool not found", 404);
  });
});

describe("GET /api/w/[slug]/pool/status - Pool Status Retrieval", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let member: User;
  let nonMember: User;

  beforeEach(async () => {
    vi.clearAllMocks();

    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Status Owner" },
        members: [{ role: "VIEWER" }],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      member = scenario.members[0];

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key-status"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `status-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      const nonMemberData = await tx.user.create({
        data: {
          name: "Non Member User",
          email: `non-member-${generateUniqueId("user")}@example.com`,
        },
      });
      nonMember = nonMemberData;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns 401 when not authenticated", async () => {
    getMocked.mockResolvedValue(null);

    const request = createGetRequest(`/api/w/${workspace.slug}/pool/status`);
    const response = await POOL_STATUS(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    await expectUnauthorized(response);
  });

  test("returns 400 when workspace slug is missing", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(owner));

    const request = createGetRequest("/api/w//pool/status");
    const response = await POOL_STATUS(request, {
      params: Promise.resolve({ slug: "" }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Workspace slug is required");
  });

  test("returns 404 when workspace not found", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(owner));

    const request = createGetRequest("/api/w/nonexistent/pool/status");
    const response = await POOL_STATUS(request, {
      params: Promise.resolve({ slug: "nonexistent" }),
    });

    await expectNotFound(response, "Workspace not found or access denied");
  });

  test("returns 404 when pool not configured", async () => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "No Pool Owner" },
    });

    getMocked.mockResolvedValue(createAuthenticatedSession(scenario.owner));

    const request = createGetRequest(
      `/api/w/${scenario.workspace.slug}/pool/status`
    );
    const response = await POOL_STATUS(request, {
      params: Promise.resolve({ slug: scenario.workspace.slug }),
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Pool not configured for this workspace");
  });

  test("successfully retrieves pool status", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(owner));

    const mockPoolStatus: PoolStatusResponse = {
      status: {
        runningVms: 3,
        pendingVms: 1,
        failedVms: 0,
        usedVms: 2,
        unusedVms: 2,
        lastCheck: "2024-01-15T10:30:00Z",
      },
    };

    mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

    const request = createGetRequest(`/api/w/${workspace.slug}/pool/status`);
    const response = await POOL_STATUS(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockPoolStatus);
    expect(data.data.status.runningVms).toBe(3);
    expect(data.data.status.pendingVms).toBe(1);
  });

  test("returns 403 for non-member access", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(nonMember));

    const request = createGetRequest(`/api/w/${workspace.slug}/pool/status`);
    const response = await POOL_STATUS(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    await expectNotFound(response, "Workspace not found or access denied");
  });

  test("allows member to access pool status", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(member));

    const mockPoolStatus: PoolStatusResponse = {
      status: {
        runningVms: 2,
        pendingVms: 0,
        failedVms: 0,
        usedVms: 1,
        unusedVms: 1,
        lastCheck: new Date().toISOString(),
      },
    };

    mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

    const request = createGetRequest(`/api/w/${workspace.slug}/pool/status`);
    const response = await POOL_STATUS(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
  });

  test("handles pool service unavailable error", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(owner));

    mockGetPoolStatus.mockRejectedValue(
      new Error("Unable to connect to pool service")
    );

    const request = createGetRequest(`/api/w/${workspace.slug}/pool/status`);
    const response = await POOL_STATUS(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    expect(response.status).toBe(503);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain("Unable to connect to pool service");
  });
});

describe("POST /api/pool-manager/claim-pod/[workspaceId] - Pod Claiming", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let member: User;
  let nonMember: User;

  beforeEach(async () => {
    vi.clearAllMocks();

    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Claim Pod Owner" },
        members: [{ role: "DEVELOPER" }],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      member = scenario.members[0];

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key-claim"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `claim-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: JSON.stringify(encryptedApiKey),
          poolName: swarm.id,
        },
      });

      const nonMemberData = await tx.user.create({
        data: {
          name: "Non Member User",
          email: `non-member-${generateUniqueId("user")}@example.com`,
        },
      });
      nonMember = nonMemberData;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns 401 when not authenticated", async () => {
    getMocked.mockResolvedValue(null);

    const request = createPostRequest(
      `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
      {}
    );
    const response = await CLAIM_POD(request, {
      params: Promise.resolve({ workspaceId: workspace.id }),
    });

    await expectUnauthorized(response);
  });

  test("returns 400 when workspaceId is missing", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(owner));

    const request = createPostRequest(
      "http://localhost/api/pool-manager/claim-pod/",
      {}
    );
    const response = await CLAIM_POD(request, {
      params: Promise.resolve({ workspaceId: "" }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe("Missing required field: workspaceId");
  });

  test("returns 404 when workspace not found", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(owner));

    const request = createPostRequest(
      "http://localhost/api/pool-manager/claim-pod/nonexistent-workspace",
      {}
    );
    const response = await CLAIM_POD(request, {
      params: Promise.resolve({ workspaceId: "nonexistent-workspace" }),
    });

    await expectNotFound(response, "Workspace not found");
  });

  test("returns 403 for non-member access", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(nonMember));

    const request = createPostRequest(
      `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
      {}
    );
    const response = await CLAIM_POD(request, {
      params: Promise.resolve({ workspaceId: workspace.id }),
    });

    await expectForbidden(response, "Access denied");
  });

  test("returns 404 when swarm not configured", async () => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "No Swarm Owner" },
    });

    getMocked.mockResolvedValue(createAuthenticatedSession(scenario.owner));

    const request = createPostRequest(
      `http://localhost/api/pool-manager/claim-pod/${scenario.workspace.id}`,
      {}
    );
    const response = await CLAIM_POD(request, {
      params: Promise.resolve({ workspaceId: scenario.workspace.id }),
    });

    await expectNotFound(response, "No swarm found for this workspace");
  });

  test("returns 400 when pool not properly configured", async () => {
    await db.swarm.update({
      where: { id: swarm.id },
      data: { poolName: null },
    });

    getMocked.mockResolvedValue(createAuthenticatedSession(owner));

    const request = createPostRequest(
      `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
      {}
    );
    const response = await CLAIM_POD(request, {
      params: Promise.resolve({ workspaceId: workspace.id }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe(
      "Swarm not properly configured with pool information"
    );
  });

  test("allows workspace owner to claim pod", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(owner));

    // Mock fetch for Pool Manager API
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        workspace: {
          portMappings: {
            "3000": "https://frontend.example.com",
            "15552": "https://ssh.example.com",
            "15553": "https://internal.example.com",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const request = createPostRequest(
      `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
      {}
    );
    const response = await CLAIM_POD(request, {
      params: Promise.resolve({ workspaceId: workspace.id }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.message).toBe("Pod claimed successfully");
    expect(data.frontend).toBe("https://frontend.example.com");
  });

  test("allows workspace member to claim pod", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(member));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        workspace: {
          portMappings: {
            "3000": "https://member-frontend.example.com",
          },
        },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const request = createPostRequest(
      `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
      {}
    );
    const response = await CLAIM_POD(request, {
      params: Promise.resolve({ workspaceId: workspace.id }),
    });

    const data = await expectSuccess(response);
    expect(data.success).toBe(true);
    expect(data.frontend).toBe("https://member-frontend.example.com");
  });

  test("handles Pool Manager API errors gracefully", async () => {
    getMocked.mockResolvedValue(createAuthenticatedSession(owner));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });
    vi.stubGlobal("fetch", mockFetch);

    const request = createPostRequest(
      `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
      {}
    );
    const response = await CLAIM_POD(request, {
      params: Promise.resolve({ workspaceId: workspace.id }),
    });

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Failed to claim pod");
  });
});

describe("Pools Service - Encryption & Data Validation", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    vi.clearAllMocks();

    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Encryption Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key-encryption"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `encryption-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: JSON.stringify(encryptedApiKey),
        },
      });
    });

    getMocked.mockResolvedValue(createAuthenticatedSession(owner));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("verifies poolApiKey is encrypted in database", async () => {
    const storedSwarm = await db.swarm.findUnique({
      where: { id: swarm.id },
      select: { poolApiKey: true },
    });

    expect(storedSwarm?.poolApiKey).toBeDefined();

    // Verify it's JSON-stringified encrypted format
    const parsed = JSON.parse(storedSwarm!.poolApiKey!);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("iv");
    expect(parsed).toHaveProperty("tag");
    expect(parsed).toHaveProperty("version");
  });

  test("decrypts poolApiKey correctly for service calls", async () => {
    const mockPoolStatus: PoolStatusResponse = {
      status: {
        runningVms: 1,
        pendingVms: 0,
        failedVms: 0,
        usedVms: 1,
        unusedVms: 0,
        lastCheck: new Date().toISOString(),
      },
    };

    mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

    const request = createGetRequest(`/api/w/${workspace.slug}/pool/status`);
    const response = await POOL_STATUS(request, {
      params: Promise.resolve({ slug: workspace.slug }),
    });

    await expectSuccess(response);

    // Verify getPoolStatus was called with encrypted poolApiKey
    expect(mockGetPoolStatus).toHaveBeenCalledWith(
      swarm.id,
      expect.any(String)
    );

    const calledWithApiKey = mockGetPoolStatus.mock.calls[0][1];
    expect(calledWithApiKey).toBeDefined();

    // Verify it's the encrypted JSON string format
    const parsed = JSON.parse(calledWithApiKey);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("iv");
  });

  test("validates encryption service handles decryption in PoolManagerService", async () => {
    const encryptionService = EncryptionService.getInstance();

    // Get stored encrypted key
    const storedSwarm = await db.swarm.findUnique({
      where: { id: swarm.id },
      select: { poolApiKey: true },
    });

    const decrypted = encryptionService.decryptField(
      "poolApiKey",
      storedSwarm!.poolApiKey!
    );

    expect(decrypted).toBe("test-pool-api-key-encryption");
  });
});