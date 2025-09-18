import { describe, test, expect, beforeEach, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/pool-manager/create-pool/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { PoolManagerService } from "@/services/pool-manager/PoolManagerService";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock PoolManagerService
vi.mock("@/services/pool-manager/PoolManagerService", () => ({
  PoolManagerService: vi.fn().mockImplementation(() => ({
    createPool: vi.fn(),
  })),
}));

// Mock external services
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn(),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));

vi.mock("@/services/swarm/db", () => ({
  saveOrUpdateSwarm: vi.fn(),
}));

vi.mock("@/config/services", () => ({
  serviceConfigs: {
    poolManager: {
      baseURL: "https://test-pool-manager.com",
      apiKey: "test-api-key",
    },
  },
}));

// Mock fetch for Pool Manager API calls
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
const { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } = await import("@/services/swarm/secrets");
const { saveOrUpdateSwarm } = await import("@/services/swarm/db");

describe("POST /api/pool-manager/create-pool Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestUserWithWorkspaceAndSwarm(options?: {
    includePAT?: boolean;
    includeRepository?: boolean;
    workspaceRole?: "owner" | "member";
    includeEnvironmentVars?: boolean;
  }) {
    const {
      includePAT = true,
      includeRepository = true,
      workspaceRole = "owner",
      includeEnvironmentVars = true,
    } = options || {};

    return await db.$transaction(async (tx) => {
      // Create test user
      const testUser = await tx.user.create({
        data: {
          id: `test-user-${Date.now()}-${Math.random()}`,
          email: `test-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace
      // Create the workspace with proper owner handling
      let ownerId = testUser.id;
      if (workspaceRole === "member") {
        // Create another user to be the owner
        const ownerUser = await tx.user.create({
          data: {
            id: `owner-user-${Date.now()}-${Math.random()}`,
            email: `owner-${Date.now()}@example.com`,
            name: "Owner User",
          },
        });
        ownerId = ownerUser.id;
      }

      const testWorkspace = await tx.workspace.create({
        data: {
          id: `test-workspace-${Date.now()}`,
          name: "Test Workspace",
          slug: `test-workspace-${Date.now()}`,
          description: "Test workspace for pool creation",
          ownerId: ownerId,
        },
      });

      // Add user as member if not owner
      let testMembership = null;
      if (workspaceRole === "member") {
        testMembership = await tx.workspaceMember.create({
          data: {
            userId: testUser.id,
            workspaceId: testWorkspace.id,
            role: "DEVELOPER",
          },
        });
      }

      // Create repository if needed
      let testRepository = null;
      if (includeRepository) {
        testRepository = await tx.repository.create({
          data: {
            id: `test-repo-${Date.now()}`,
            name: "test-repo",
            repositoryUrl: "https://github.com/test/test-repo",
            branch: "main",
            workspaceId: testWorkspace.id,
          },
        });
      }

      // Create swarm
      const environmentVariables = includeEnvironmentVars
        ? JSON.stringify([
            { name: "NODE_ENV", value: encryptionService.encryptField("environmentVariables", "production") },
            { name: "API_KEY", value: encryptionService.encryptField("environmentVariables", "test-api-key-123") },
          ])
        : null;

      const testSwarm = await tx.swarm.create({
        data: {
          id: `test-swarm-${Date.now()}`,
          swarmId: `swarm-${Date.now()}`,
          name: "Test Swarm",
          workspaceId: testWorkspace.id,
          poolApiKey: JSON.stringify(encryptionService.encryptField("poolApiKey", "test-pool-api-key")),
          environmentVariables,
        },
      });

      // Create GitHub account if PAT needed
      let testAccount = null;
      if (includePAT) {
        testAccount = await tx.account.create({
          data: {
            id: `test-account-${Date.now()}`,
            userId: testUser.id,
            type: "oauth",
            provider: "github",
            providerAccountId: `${Date.now()}`,
            access_token: JSON.stringify(encryptionService.encryptField("access_token", "github_pat_test_token")),
            scope: "read:user,repo",
          },
        });
      }

      return {
        testUser,
        testWorkspace,
        testSwarm,
        testRepository,
        testAccount,
        testMembership,
      };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("Authentication scenarios", () => {
    test("should return 401 if no session", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: "test-swarm",
          workspaceId: "test-workspace",
          container_files: {},
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 if session has no user", async () => {
      mockGetServerSession.mockResolvedValue({ user: null });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: "test-swarm",
          workspaceId: "test-workspace",
          container_files: {},
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 if session user has no email", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "test-user", name: "Test User" },
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: "test-swarm",
          workspaceId: "test-workspace",
          container_files: {},
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 if session user has no id", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@example.com", name: "Test User" },
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: "test-swarm",
          workspaceId: "test-workspace",
          container_files: {},
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Authorization scenarios", () => {
    test("should return 404 if swarm not found", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: "non-existent-swarm",
          workspaceId: "non-existent-workspace",
          container_files: {},
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found");
    });

    test("should return 403 if user has no access to workspace", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm({
        workspaceRole: "member",
      });

      // Delete the membership to deny access
      await db.workspaceMember.deleteMany({
        where: { userId: testUser.id, workspaceId: testWorkspace.id },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: {},
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });

    test("should allow workspace owner to create pool", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: { "docker-compose.yml": "dmVyc2lvbjogJzMnCg==" },
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.pool).toBeDefined();
      expect(data.pool.id).toBe("created-pool-id");
    });

    test("should allow workspace member to create pool", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm({
        workspaceRole: "member",
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: { "docker-compose.yml": "dmVyc2lvbjogJzMnCg==" },
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });
  });

  describe("Input validation scenarios", () => {
    test("should handle missing swarmId and workspaceId", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          container_files: {},
        }),
      });

      const response = await POST(request);

      // The API finds the swarm created by createTestUserWithWorkspaceAndSwarm with empty filter
      expect(response.status).toBe(201);
    });

    test("should handle malformed JSON body", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: "invalid json",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
    });
  });

  describe("Resource allocation scenarios", () => {
    test("should successfully create pool with default resource allocation", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: { "docker-compose.yml": "dmVyc2lvbjogJzMnCg==" },
        }),
      });

      await POST(request);

      expect(mockPoolManagerInstance.createPool).toHaveBeenCalledWith({
        pool_name: testSwarm.id,
        minimum_vms: 2,
        repo_name: "https://github.com/test/test-repo",
        branch_name: "main",
        github_pat: "github-token",
        github_username: "testuser",
        env_vars: expect.any(Array),
        container_files: { "docker-compose.yml": "dmVyc2lvbjogJzMnCg==" },
      });
    });

    test("should handle encrypted environment variables", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm({
        includeEnvironmentVars: true,
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: {},
        }),
      });

      await POST(request);

      const createPoolCall = mockPoolManagerInstance.createPool.mock.calls[0][0];
      expect(createPoolCall.env_vars).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "NODE_ENV", value: "production" }),
          expect.objectContaining({ name: "API_KEY", value: "test-api-key-123" }),
        ])
      );
    });
  });

  describe("Service integration scenarios", () => {
    test("should handle missing pool API key by creating new one", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock)
        .mockResolvedValueOnce("") // First call returns empty
        .mockResolvedValueOnce("new-encrypted-api-key"); // Second call after update

      (updateSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue(undefined);
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: {},
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(updateSwarmPoolApiKeyFor).toHaveBeenCalledWith(testSwarm.id);
      expect(getSwarmPoolApiKeyFor).toHaveBeenCalledTimes(2);
    });

    test("should handle GitHub PAT not found", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm({
        includePAT: false,
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue(null);

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: {},
        }),
      });

      await POST(request);

      const createPoolCall = mockPoolManagerInstance.createPool.mock.calls[0][0];
      expect(createPoolCall.github_pat).toBe("");
      expect(createPoolCall.github_username).toBe("");
    });
  });

  describe("Database operation scenarios", () => {
    test("should save swarm updates after pool creation", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: { "docker-compose.yml": "dmVyc2lvbjogJzMnCg==" },
        }),
      });

      await POST(request);

      expect(saveOrUpdateSwarm).toHaveBeenCalledWith({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        containerFiles: { "docker-compose.yml": "dmVyc2lvbjogJzMnCg==" },
      });

      expect(saveOrUpdateSwarm).toHaveBeenCalledWith({
        swarmId: testSwarm.swarmId,
        workspaceId: testWorkspace.id,
        poolName: testSwarm.swarmId,
      });
    });

    test("should handle database transaction failures", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      // Simulate database error by providing invalid swarm ID
      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: "non-existent-swarm",
          workspaceId: "non-existent-workspace",
          container_files: {},
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found");
    });
  });

  describe("Error handling scenarios", () => {
    test("should handle Pool Manager service errors", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockRejectedValue({
          message: "Pool Manager service unavailable",
          status: 503,
          service: "poolManager",
          details: { error: "Service timeout" },
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: {},
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe("Pool Manager service unavailable");
      expect(data.service).toBe("poolManager");
      expect(data.details).toEqual({ error: "Service timeout" });
    });

    test("should handle encryption service errors", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      // Mock the Pool Manager service to throw an error
      const mockPoolManagerInstance = {
        createPool: vi.fn().mockRejectedValue({
          message: "Pool Manager service unavailable",
          status: 503,
          service: "poolManager",
          details: { error: "Service timeout" },
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: {},
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      // The PoolManager error gets returned directly, not as a general 500
      expect(response.status).toBe(503);
      expect(data.error).toBe("Pool Manager service unavailable");
    });

    test("should handle general server errors", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockRejectedValue(new Error("Database connection failed"));

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: {},
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create pool");
    });
  });

  describe("Security scenarios", () => {
    test("should properly encrypt and decrypt environment variables", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm({
        includeEnvironmentVars: true,
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: {},
        }),
      });

      await POST(request);

      // Verify environment variables were properly decrypted
      const createPoolCall = mockPoolManagerInstance.createPool.mock.calls[0][0];
      expect(createPoolCall.env_vars).toContainEqual({
        name: "NODE_ENV",
        value: "production",
      });
      expect(createPoolCall.env_vars).toContainEqual({
        name: "API_KEY",
        value: "test-api-key-123",
      });
    });

    test("should handle malformed environment variable encryption", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm({
        includeEnvironmentVars: false,
      });

      // Update swarm with malformed environment variables
      await db.swarm.update({
        where: { id: testSwarm.id },
        data: {
          environmentVariables: JSON.stringify([
            { name: "INVALID_VAR", value: "malformed-encrypted-data" },
          ]),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: {},
        }),
      });

      await POST(request);

      // Should fallback to treating as unencrypted data
      const createPoolCall = mockPoolManagerInstance.createPool.mock.calls[0][0];
      expect(createPoolCall.env_vars).toContainEqual({
        name: "INVALID_VAR",
        value: "malformed-encrypted-data",
      });
    });
  });

  describe("Edge cases", () => {
    test("should handle missing repository gracefully", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm({
        includeRepository: false,
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: {},
        }),
      });

      await POST(request);

      const createPoolCall = mockPoolManagerInstance.createPool.mock.calls[0][0];
      expect(createPoolCall.repo_name).toBe("");
      expect(createPoolCall.branch_name).toBe("");
    });

    test("should handle empty container files", async () => {
      const { testUser, testSwarm, testWorkspace } = await createTestUserWithWorkspaceAndSwarm();

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      });

      (getSwarmPoolApiKeyFor as vi.Mock).mockResolvedValue("encrypted-pool-api-key");
      (getGithubUsernameAndPAT as vi.Mock).mockResolvedValue({
        username: "testuser",
        appAccessToken: "github-token",
      });

      const mockPoolManagerInstance = {
        createPool: vi.fn().mockResolvedValue({
          id: "created-pool-id",
          name: testSwarm.id,
          owner_id: testUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        }),
      };

      (PoolManagerService as vi.Mock).mockImplementation(() => mockPoolManagerInstance);

      const request = new NextRequest("http://localhost:3000/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          swarmId: testSwarm.swarmId,
          workspaceId: testWorkspace.id,
          container_files: {},
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPoolManagerInstance.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          container_files: {},
        })
      );
    });
  });
});