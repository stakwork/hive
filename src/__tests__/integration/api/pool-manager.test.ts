import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/pool-manager/create-pool/route";
import { DELETE } from "@/app/api/pool-manager/delete-pool/route";
import { GET } from "@/app/api/w/[slug]/pool/status/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import * as poolApi from "@/services/pool-manager/api/pool";
import * as swarmSecrets from "@/services/swarm/secrets";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
  expectForbidden,
  expectError,
  getMockedSession,
  createPostRequest,
  createDeleteRequest,
  createGetRequest,
} from "@/__tests__/support/helpers";

// Mock next-auth for session management
vi.mock("next-auth/next");

// Mock getGithubUsernameAndPAT to return test credentials
vi.mock("@/lib/auth/nextauth", async () => {
  const actual = await vi.importActual("@/lib/auth/nextauth");
  return {
    ...actual,
    getGithubUsernameAndPAT: vi.fn().mockResolvedValue({
      username: "testuser",
      token: "test-github-token",
    }),
  };
});

const encryptionService = EncryptionService.getInstance();

describe("Pool Manager API Integration Tests", () => {
  async function createTestWorkspaceWithSwarm() {
    const scenario = await createTestWorkspaceScenario({
      owner: {
        name: "Owner User",
      },
    });

    // Create a swarm for this workspace
    const encryptedApiKey = encryptionService.encryptField("poolApiKey", "test-pool-api-key");
    
    const swarm = await db.swarm.create({
      data: {
        workspaceId: scenario.workspace.id,
        swarmId: `test-swarm-${scenario.workspace.id}`,
        name: "Test Swarm",
        instanceType: "t2.micro",
        status: "ACTIVE",
        poolName: `pool-${scenario.workspace.id}`,
        poolApiKey: JSON.stringify(encryptedApiKey),
        environmentVariables: [],
        repositoryName: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        poolCpu: "2",
        poolMemory: "4Gi",
        services: [],
        containerFiles: {},
      },
    });

    // Create a repository for the workspace
    await db.repository.create({
      data: {
        workspaceId: scenario.workspace.id,
        name: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        branch: "main",
      },
    });

    return {
      ownerUser: scenario.owner,
      workspace: scenario.workspace,
      swarm,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("POST /api/pool-manager/create-pool", () => {
    describe("Success scenarios", () => {
      test("should create pool successfully with valid data", async () => {
        const { ownerUser, workspace, swarm } = await createTestWorkspaceWithSwarm();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

        // Mock getSwarmPoolApiKeyFor to return encrypted API key
        vi.spyOn(swarmSecrets, "getSwarmPoolApiKeyFor").mockResolvedValue(
          JSON.stringify(encryptionService.encryptField("poolApiKey", "test-pool-api-key"))
        );

        // Mock external Pool Manager API call
        const mockPoolResponse = {
          id: "pool-123",
          name: swarm.swarmId,
          status: "active" as const,
          owner_id: ownerUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          description: "Test pool",
        };

        vi.spyOn(poolApi, "createPoolApi").mockResolvedValue(mockPoolResponse);

        const request = createPostRequest("/api/pool-manager/create-pool", {
          workspaceId: workspace.id,
          container_files: {
            "Dockerfile": "RlJPTSBub2RlOjE4", // base64 encoded
            ".devcontainer/devcontainer.json": "eyJ0ZXN0IjoidHJ1ZSJ9", // base64 encoded
          },
        });

        const response = await POST(request);
        const data = await expectSuccess(response, 201);

        expect(data.pool).toBeDefined();
        expect(data.pool.name).toBe(swarm.swarmId);

        // Verify external Pool Manager API was called with correct parameters
        expect(poolApi.createPoolApi).toHaveBeenCalledWith(
          expect.any(Object), // HttpClient
          expect.objectContaining({
            pool_name: swarm.id,
            minimum_vms: 2,
            repo_name: "https://github.com/test/repo",
            branch_name: "main",
            github_pat: "test-github-token",
            github_username: "testuser",
            env_vars: expect.any(Array),
            container_files: expect.any(Object),
          }),
          "poolManager"
        );

        // Verify swarm was updated with poolState
        const updatedSwarm = await db.swarm.findUnique({
          where: { id: swarm.id },
        });
        expect(updatedSwarm?.poolState).toBe("COMPLETE");
      });

      test("should handle container files from existing swarm data", async () => {
        const { ownerUser, workspace, swarm } = await createTestWorkspaceWithSwarm();

        // Update swarm with existing container files
        await db.swarm.update({
          where: { id: swarm.id },
          data: {
            containerFiles: {
              "Dockerfile": "existing-content",
            },
          },
        });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

        vi.spyOn(swarmSecrets, "getSwarmPoolApiKeyFor").mockResolvedValue(
          JSON.stringify(encryptionService.encryptField("poolApiKey", "test-pool-api-key"))
        );

        const mockPoolResponse = {
          id: "pool-123",
          name: swarm.swarmId,
          status: "active" as const,
          owner_id: ownerUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          description: "Test pool",
        };

        vi.spyOn(poolApi, "createPoolApi").mockResolvedValue(mockPoolResponse);

        const request = createPostRequest("/api/pool-manager/create-pool", {
          workspaceId: workspace.id,
          container_files: {
            "Dockerfile": "new-content", // This should be ignored
          },
        });

        const response = await POST(request);
        await expectSuccess(response, 201);

        // Verify that existing container files were used
        expect(poolApi.createPoolApi).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            container_files: { "Dockerfile": "existing-content" },
          }),
          "poolManager"
        );
      });
    });

    describe("Authentication and authorization scenarios", () => {
      test("should return 401 for unauthenticated request", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createPostRequest("/api/pool-manager/create-pool", {
          workspaceId: "test-workspace-id",
          container_files: {},
        });

        const response = await POST(request);
        await expectUnauthorized(response);

        expect(poolApi.createPoolApi).not.toHaveBeenCalled();
      });

      test("should return 401 for session without user ID", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id field
        });

        const request = createPostRequest("/api/pool-manager/create-pool", {
          workspaceId: "test-workspace-id",
          container_files: {},
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe("Invalid user session");
      });

      test("should return 403 for user without workspace access", async () => {
        const { workspace } = await createTestWorkspaceWithSwarm();
        const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

        const request = createPostRequest("/api/pool-manager/create-pool", {
          workspaceId: workspace.id,
          container_files: {},
        });

        const response = await POST(request);
        await expectForbidden(response, "Access denied");
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 404 for non-existent swarm", async () => {
        const testUser = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        const request = createPostRequest("/api/pool-manager/create-pool", {
          workspaceId: "non-existent-workspace-id",
          container_files: {},
        });

        const response = await POST(request);
        await expectNotFound(response, "Swarm not found");
      });

      test("should return 404 when workspace is not found", async () => {
        const testUser = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        const request = createPostRequest("/api/pool-manager/create-pool", {
          swarmId: "non-existent-swarm",
          container_files: {},
        });

        const response = await POST(request);
        await expectNotFound(response, "Swarm not found");
      });
    });

    describe("External service error scenarios", () => {
      test("should handle external Pool Manager API failure", async () => {
        const { ownerUser, workspace } = await createTestWorkspaceWithSwarm();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

        vi.spyOn(swarmSecrets, "getSwarmPoolApiKeyFor").mockResolvedValue(
          JSON.stringify(encryptionService.encryptField("poolApiKey", "test-pool-api-key"))
        );

        // Mock external API failure
        vi.spyOn(poolApi, "createPoolApi").mockRejectedValue({
          message: "Pool creation failed",
          status: 500,
          service: "poolManager",
          details: { reason: "Internal server error" },
        });

        const request = createPostRequest("/api/pool-manager/create-pool", {
          workspaceId: workspace.id,
          container_files: {},
        });

        const response = await POST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Pool creation failed");
        expect(data.service).toBe("poolManager");

        // Verify swarm poolState was set to FAILED
        const swarm = await db.swarm.findFirst({
          where: { workspaceId: workspace.id },
        });
        expect(swarm?.poolState).toBe("FAILED");
      });

      test("should retry pool creation on transient failures", async () => {
        const { ownerUser, workspace, swarm } = await createTestWorkspaceWithSwarm();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

        vi.spyOn(swarmSecrets, "getSwarmPoolApiKeyFor").mockResolvedValue(
          JSON.stringify(encryptionService.encryptField("poolApiKey", "test-pool-api-key"))
        );

        const mockPoolResponse = {
          id: "pool-123",
          name: swarm.swarmId,
          status: "active" as const,
          owner_id: ownerUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          description: "Test pool",
        };

        // Mock failure on first two attempts, success on third
        const createPoolSpy = vi.spyOn(poolApi, "createPoolApi")
          .mockRejectedValueOnce(new Error("Transient failure 1"))
          .mockRejectedValueOnce(new Error("Transient failure 2"))
          .mockResolvedValueOnce(mockPoolResponse);

        const request = createPostRequest("/api/pool-manager/create-pool", {
          workspaceId: workspace.id,
          container_files: {},
        });

        const response = await POST(request);
        await expectSuccess(response, 201);

        // Verify retry attempts (should be called 3 times)
        expect(createPoolSpy).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe("DELETE /api/pool-manager/delete-pool", () => {
    describe("Success scenarios", () => {
      test("should delete pool successfully", async () => {
        const { ownerUser } = await createTestWorkspaceWithSwarm();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

        const mockDeleteResponse = {
          id: "pool-123",
          name: "test-pool",
          status: "deleted" as const,
          owner_id: ownerUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          description: "Test pool",
        };

        vi.spyOn(poolApi, "deletePoolApi").mockResolvedValue(mockDeleteResponse);

        const request = createDeleteRequest("/api/pool-manager/delete-pool");
        // Manually set the body for DELETE request
        const requestWithBody = new Request(request.url, {
          method: "DELETE",
          headers: request.headers,
          body: JSON.stringify({ name: "test-pool" }),
        });

        const response = await DELETE(requestWithBody as any);
        const data = await expectSuccess(response, 201);

        expect(data.pool).toBeDefined();
        expect(data.pool.name).toBe("test-pool");

        expect(poolApi.deletePoolApi).toHaveBeenCalledWith(
          expect.any(Object),
          { name: "test-pool" },
          "poolManager"
        );
      });
    });

    describe("Authentication scenarios", () => {
      test("should return 401 for unauthenticated request", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createDeleteRequest("/api/pool-manager/delete-pool");
        const requestWithBody = new Request(request.url, {
          method: "DELETE",
          headers: request.headers,
          body: JSON.stringify({ name: "test-pool" }),
        });

        const response = await DELETE(requestWithBody as any);
        await expectUnauthorized(response);

        expect(poolApi.deletePoolApi).not.toHaveBeenCalled();
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 400 for missing pool name", async () => {
        const { ownerUser } = await createTestWorkspaceWithSwarm();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

        const request = createDeleteRequest("/api/pool-manager/delete-pool");
        const requestWithBody = new Request(request.url, {
          method: "DELETE",
          headers: request.headers,
          body: JSON.stringify({}), // Missing name
        });

        const response = await DELETE(requestWithBody as any);
        await expectError(response, "Missing required field: name", 400);

        expect(poolApi.deletePoolApi).not.toHaveBeenCalled();
      });
    });

    describe("External service error scenarios", () => {
      test("should handle external Pool Manager API failure", async () => {
        const { ownerUser } = await createTestWorkspaceWithSwarm();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

        vi.spyOn(poolApi, "deletePoolApi").mockRejectedValue({
          message: "Pool not found",
          status: 404,
          service: "poolManager",
          details: {},
        });

        const request = createDeleteRequest("/api/pool-manager/delete-pool");
        const requestWithBody = new Request(request.url, {
          method: "DELETE",
          headers: request.headers,
          body: JSON.stringify({ name: "non-existent-pool" }),
        });

        const response = await DELETE(requestWithBody as any);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.error).toBe("Pool not found");
        expect(data.service).toBe("poolManager");
      });
    });
  });

  describe("GET /api/w/[slug]/pool/status", () => {
    describe("Success scenarios", () => {
      test("should return pool status successfully", async () => {
        const { ownerUser, workspace, swarm } = await createTestWorkspaceWithSwarm();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

        // Mock PoolManagerService.getPoolStatus via fetch
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            status: {
              running_vms: 2,
              pending_vms: 1,
              failed_vms: 0,
              used_vms: 1,
              unused_vms: 1,
              last_check: new Date().toISOString(),
            },
          }),
        });

        const request = createGetRequest(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);

        const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });
        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data).toBeDefined();
        expect(data.data.status).toMatchObject({
          runningVms: 2,
          pendingVms: 1,
          failedVms: 0,
          usedVms: 1,
          unusedVms: 1,
        });

        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringMatching(/\/pools\//),
          expect.objectContaining({
            method: "GET",
            headers: expect.objectContaining({
              Authorization: expect.stringContaining("Bearer"),
            }),
          })
        );
      });
    });

    describe("Authentication scenarios", () => {
      test("should return 401 for unauthenticated request", async () => {
        const { workspace } = await createTestWorkspaceWithSwarm();

        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);

        const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });
        await expectUnauthorized(response);
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 400 for missing workspace slug", async () => {
        const testUser = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        const request = createGetRequest("http://localhost:3000/api/w//pool/status");

        const response = await GET(request, { params: Promise.resolve({ slug: "" }) });
        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe("Workspace slug is required");
      });

      test("should return 404 for non-existent workspace", async () => {
        const testUser = await createTestUser();
        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        const request = createGetRequest("http://localhost:3000/api/w/non-existent/pool/status");

        const response = await GET(request, { params: Promise.resolve({ slug: "non-existent" }) });
        await expectNotFound(response, "Workspace not found or access denied");
      });

      test("should return 404 when swarm not configured", async () => {
        const scenario = await createTestWorkspaceScenario({
          owner: { name: "Owner User" },
        });
        // No swarm created for this workspace

        getMockedSession().mockResolvedValue(createAuthenticatedSession(scenario.owner));

        const request = createGetRequest(`http://localhost:3000/api/w/${scenario.workspace.slug}/pool/status`);

        const response = await GET(request, {
          params: Promise.resolve({ slug: scenario.workspace.slug }),
        });
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.message).toBe("Pool not configured for this workspace");
      });
    });

    describe("External service error scenarios", () => {
      test("should return 503 when pool manager is unavailable", async () => {
        const { ownerUser, workspace } = await createTestWorkspaceWithSwarm();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

        // Mock Pool Manager fetch failure
        global.fetch = vi.fn().mockRejectedValue(new Error("Unable to connect to pool service"));

        const request = createGetRequest(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);

        const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });
        const data = await response.json();

        expect(response.status).toBe(503);
        expect(data.success).toBe(false);
        expect(data.message).toContain("Unable to connect to pool service");
      });

      test("should return 503 when pool manager returns error", async () => {
        const { ownerUser, workspace } = await createTestWorkspaceWithSwarm();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

        // Mock Pool Manager error response
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        });

        const request = createGetRequest(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);

        const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });
        const data = await response.json();

        expect(response.status).toBe(503);
        expect(data.success).toBe(false);
        expect(data.message).toContain("Unable to connect to pool service");
      });
    });
  });
});