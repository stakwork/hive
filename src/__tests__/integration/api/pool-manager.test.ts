import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST as CreatePoolPOST } from "@/app/api/pool-manager/create-pool/route";
import { DELETE as DeletePoolDELETE } from "@/app/api/pool-manager/delete-pool/route";
import { GET as GetPoolStatusGET } from "@/app/api/w/[slug]/pool/status/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectError,
  generateUniqueId,
  createPostRequest,
  createDeleteRequest,
  createGetRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import * as poolApi from "@/services/pool-manager/api/pool";
import * as swarmSecrets from "@/services/swarm/secrets";
import * as githubAuth from "@/lib/auth/nextauth";

// Mock external dependencies
vi.mock("@/services/pool-manager/api/pool");
vi.mock("@/services/swarm/secrets");
vi.mock("@/lib/auth/nextauth", async () => {
  const actual = await vi.importActual("@/lib/auth/nextauth");
  return {
    ...actual,
    getGithubUsernameAndPAT: vi.fn(),
  };
});

describe("Pool Manager API Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  // Helper to create test swarm with workspace
  async function createTestSwarmScenario() {
    const testUser = await createTestUser({ name: "Test Owner" });
    const testWorkspace = await createTestWorkspace({
      ownerId: testUser.id,
      name: "Test Workspace",
      slug: generateUniqueId("workspace"),
    });

    // Create repository for the workspace
    const testRepository = await db.repository.create({
      data: {
        workspaceId: testWorkspace.id,
        repositoryUrl: "https://github.com/test-org/test-repo",
        branch: "main",
        name: "test-repo",
      },
    });

    // Create swarm linked to workspace
    const poolApiKey = JSON.stringify(
      encryptionService.encryptField("poolApiKey", "test-pool-api-key")
    );

    const testSwarm = await db.swarm.create({
      data: {
        id: generateUniqueId("swarm"),
        swarmId: generateUniqueId("swarm"),
        workspaceId: testWorkspace.id,
        name: "Test Swarm",
        poolApiKey,
        environmentVariables: JSON.stringify([
          { name: "TEST_ENV", value: "test-value" },
        ]),
        containerFiles: {
          "Dockerfile": "FROM node:18",
        },
      },
    });

    return {
      testUser,
      testWorkspace,
      testRepository,
      testSwarm,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.spyOn(githubAuth, "getGithubUsernameAndPAT").mockResolvedValue({
      username: "testuser",
      token: "github_pat_test_token",
    });

    vi.spyOn(swarmSecrets, "getSwarmPoolApiKeyFor").mockResolvedValue(
      JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-api-key")
      )
    );

    vi.spyOn(swarmSecrets, "updateSwarmPoolApiKeyFor").mockResolvedValue(undefined);
  });

  describe("POST /api/pool-manager/create-pool", () => {
    describe("Success scenarios", () => {
      test("should create pool successfully with valid authentication and workspace access", async () => {
        const { testUser, testWorkspace, testSwarm } = await createTestSwarmScenario();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock successful Pool Manager API response
        vi.spyOn(poolApi, "createPoolApi").mockResolvedValue({
          id: "pool-123",
          name: testSwarm.id,
          description: "Test pool",
          owner_id: "owner-123",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        });

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: testSwarm.swarmId,
            workspaceId: testWorkspace.id,
            container_files: {
              "Dockerfile": "FROM node:18",
            },
          }
        );

        const response = await CreatePoolPOST(request);
        const data = await expectSuccess(response, 201);

        expect(data.pool).toBeDefined();
        expect(data.pool.name).toBe(testSwarm.id);

        // Verify Pool Manager API was called with correct parameters
        expect(poolApi.createPoolApi).toHaveBeenCalledWith(
          expect.any(Object), // HttpClient
          expect.objectContaining({
            pool_name: testSwarm.id,
            minimum_vms: 2,
            repo_name: "https://github.com/test-org/test-repo",
            branch_name: "main",
            github_pat: "github_pat_test_token",
            github_username: "testuser",
            env_vars: expect.arrayContaining([
              expect.objectContaining({
                name: "TEST_ENV",
                value: "test-value",
              }),
            ]),
            container_files: expect.any(Object),
          }),
          "poolManager"
        );

        // Verify swarm was updated with pool state
        const updatedSwarm = await db.swarm.findUnique({
          where: { id: testSwarm.id },
        });
        expect(updatedSwarm?.poolState).toBe("COMPLETE");
      });

      test("should handle existing container files from database", async () => {
        const { testUser, testWorkspace, testSwarm } = await createTestSwarmScenario();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        vi.spyOn(poolApi, "createPoolApi").mockResolvedValue({
          id: "pool-123",
          name: testSwarm.id,
          description: "Test pool",
          owner_id: "owner-123",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        });

        // Request with different container files - should use existing ones from DB
        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: testSwarm.swarmId,
            workspaceId: testWorkspace.id,
            container_files: {
              "Dockerfile": "FROM python:3.9", // Different from DB
            },
          }
        );

        const response = await CreatePoolPOST(request);
        const data = await expectSuccess(response, 201);

        expect(data.pool).toBeDefined();

        // Verify existing container files from DB were used
        expect(poolApi.createPoolApi).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            container_files: {
              "Dockerfile": "FROM node:18", // Original from DB
            },
          }),
          "poolManager"
        );
      });

      test("should retry pool creation on failure", async () => {
        const { testUser, testWorkspace, testSwarm } = await createTestSwarmScenario();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock first two calls to fail, third to succeed
        vi.spyOn(poolApi, "createPoolApi")
          .mockRejectedValueOnce(new Error("Temporary failure"))
          .mockRejectedValueOnce(new Error("Temporary failure"))
          .mockResolvedValueOnce({
            id: "pool-123",
            name: testSwarm.id,
            description: "Test pool",
            owner_id: "owner-123",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            status: "active",
          });

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: testSwarm.swarmId,
            workspaceId: testWorkspace.id,
            container_files: {
              "Dockerfile": "FROM node:18",
            },
          }
        );

        const response = await CreatePoolPOST(request);
        const data = await expectSuccess(response, 201);

        expect(data.pool).toBeDefined();
        expect(poolApi.createPoolApi).toHaveBeenCalledTimes(3);
      });
    });

    describe("Authentication and authorization scenarios", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: "test-swarm",
            workspaceId: "test-workspace",
          }
        );

        const response = await CreatePoolPOST(request);

        await expectUnauthorized(response);
        expect(poolApi.createPoolApi).not.toHaveBeenCalled();
      });

      test("should return 401 for session without email", async () => {
        const testUser = await createTestUser({ email: "test@example.com" });

        getMockedSession().mockResolvedValue({
          user: { id: testUser.id, name: testUser.name }, // Missing email
        });

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: "test-swarm",
            workspaceId: "test-workspace",
          }
        );

        const response = await CreatePoolPOST(request);

        await expectUnauthorized(response);
        expect(poolApi.createPoolApi).not.toHaveBeenCalled();
      });

      test("should return 401 for session without user id", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com", name: "Test User" }, // Missing id
        });

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: "test-swarm",
            workspaceId: "test-workspace",
          }
        );

        const response = await CreatePoolPOST(request);
        const data = await response.json();

        expect(response.status).toBe(401);
        expect(data.error).toBe("Invalid user session");
        expect(poolApi.createPoolApi).not.toHaveBeenCalled();
      });

      test("should return 404 when swarm not found", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: "nonexistent-swarm",
            workspaceId: "nonexistent-workspace",
          }
        );

        const response = await CreatePoolPOST(request);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.error).toBe("Swarm not found");
        expect(poolApi.createPoolApi).not.toHaveBeenCalled();
      });

      test("should return 403 for user without workspace access", async () => {
        const { testWorkspace, testSwarm } = await createTestSwarmScenario();

        // Create different user without access
        const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: testSwarm.swarmId,
            workspaceId: testWorkspace.id,
          }
        );

        const response = await CreatePoolPOST(request);
        const data = await response.json();

        expect(response.status).toBe(403);
        expect(data.error).toBe("Access denied");
        expect(poolApi.createPoolApi).not.toHaveBeenCalled();
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 404 when workspace not found in swarm", async () => {
        const testUser = await createTestUser();
        const testWorkspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueId("workspace"),
        });

        // Create swarm without workspace relationship
        const testSwarm = await db.swarm.create({
          data: {
            id: generateUniqueId("swarm"),
            swarmId: generateUniqueId("swarm"),
            workspaceId: testWorkspace.id,
            name: "Test Swarm",
          },
        });

        // Delete workspace to simulate missing relationship
        await db.workspace.delete({ where: { id: testWorkspace.id } });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: testSwarm.swarmId,
            workspaceId: testWorkspace.id,
          }
        );

        const response = await CreatePoolPOST(request);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.error).toBe("Swarm not found");
        expect(poolApi.createPoolApi).not.toHaveBeenCalled();
      });

      test("should handle missing swarm id", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            // Missing swarmId
            workspaceId: "test-workspace",
          }
        );

        const response = await CreatePoolPOST(request);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.error).toBe("Swarm not found");
        expect(poolApi.createPoolApi).not.toHaveBeenCalled();
      });
    });

    describe("External service error scenarios", () => {
      test("should handle Pool Manager API failure and update swarm state to FAILED", async () => {
        const { testUser, testWorkspace, testSwarm } = await createTestSwarmScenario();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock Pool Manager API failure
        vi.spyOn(poolApi, "createPoolApi").mockRejectedValue({
          message: "Pool creation failed",
          status: 500,
          service: "poolManager",
          details: { reason: "Internal server error" },
        });

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: testSwarm.swarmId,
            workspaceId: testWorkspace.id,
            container_files: {
              "Dockerfile": "FROM node:18",
            },
          }
        );

        const response = await CreatePoolPOST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Pool creation failed");
        expect(data.service).toBe("poolManager");
        expect(data.details).toEqual({ reason: "Internal server error" });

        // Verify swarm state was updated to FAILED
        const updatedSwarm = await db.swarm.findUnique({
          where: { id: testSwarm.id },
        });
        expect(updatedSwarm?.poolState).toBe("FAILED");
      });

      test("should handle GitHub PAT retrieval failure", async () => {
        const { testUser, testWorkspace, testSwarm } = await createTestSwarmScenario();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock GitHub PAT retrieval failure
        vi.spyOn(githubAuth, "getGithubUsernameAndPAT").mockResolvedValue(null);

        vi.spyOn(poolApi, "createPoolApi").mockResolvedValue({
          id: "pool-123",
          name: testSwarm.id,
          description: "Test pool",
          owner_id: "owner-123",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active",
        });

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: testSwarm.swarmId,
            workspaceId: testWorkspace.id,
            container_files: {
              "Dockerfile": "FROM node:18",
            },
          }
        );

        const response = await CreatePoolPOST(request);
        const data = await expectSuccess(response, 201);

        expect(data.pool).toBeDefined();

        // Verify empty GitHub credentials were passed
        expect(poolApi.createPoolApi).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            github_pat: "",
            github_username: "",
          }),
          "poolManager"
        );
      });

      test("should handle pool API key retrieval failure", async () => {
        const { testUser, testWorkspace, testSwarm } = await createTestSwarmScenario();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock pool API key retrieval failure
        vi.spyOn(swarmSecrets, "getSwarmPoolApiKeyFor").mockResolvedValue("");

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: testSwarm.swarmId,
            workspaceId: testWorkspace.id,
            container_files: {
              "Dockerfile": "FROM node:18",
            },
          }
        );

        const response = await CreatePoolPOST(request);

        // Should trigger updateSwarmPoolApiKeyFor
        expect(swarmSecrets.updateSwarmPoolApiKeyFor).toHaveBeenCalledWith(testSwarm.id);
        expect(swarmSecrets.getSwarmPoolApiKeyFor).toHaveBeenCalledTimes(2);
      });

      test("should handle retry exhaustion and return error", async () => {
        const { testUser, testWorkspace, testSwarm } = await createTestSwarmScenario();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock all retry attempts to fail
        vi.spyOn(poolApi, "createPoolApi").mockRejectedValue(
          new Error("Persistent failure")
        );

        const request = createPostRequest(
          "http://localhost:3000/api/pool-manager/create-pool",
          {
            swarmId: testSwarm.swarmId,
            workspaceId: testWorkspace.id,
            container_files: {
              "Dockerfile": "FROM node:18",
            },
          }
        );

        const response = await CreatePoolPOST(request);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to create pool");

        // Verify retry attempts (3 retries + 1 initial = 4 total)
        expect(poolApi.createPoolApi).toHaveBeenCalledTimes(4);

        // Verify swarm state was updated to FAILED
        const updatedSwarm = await db.swarm.findUnique({
          where: { id: testSwarm.id },
        });
        expect(updatedSwarm?.poolState).toBe("FAILED");
      });
    });
  });

  describe("DELETE /api/pool-manager/delete-pool", () => {
    describe("Success scenarios", () => {
      test("should delete pool successfully with valid authentication", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock successful Pool Manager API response
        vi.spyOn(poolApi, "deletePoolApi").mockResolvedValue({
          id: "pool-123",
          name: "test-pool",
          description: "Deleted pool",
          owner_id: "owner-123",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "deleted",
        });

        const request = createDeleteRequest(
          "http://localhost:3000/api/pool-manager/delete-pool"
        );

        // Override request body for DELETE (not standard but used in this endpoint)
        const requestWithBody = new Request(request.url, {
          method: "DELETE",
          headers: request.headers,
          body: JSON.stringify({ name: "test-pool" }),
        });

        const response = await DeletePoolDELETE(requestWithBody as any);
        const data = await expectSuccess(response, 201);

        expect(data.pool).toBeDefined();
        expect(data.pool.name).toBe("test-pool");
        expect(data.pool.status).toBe("deleted");

        // Verify Pool Manager API was called
        expect(poolApi.deletePoolApi).toHaveBeenCalledWith(
          expect.any(Object), // HttpClient
          { name: "test-pool" },
          "poolManager"
        );
      });
    });

    describe("Authentication scenarios", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createDeleteRequest(
          "http://localhost:3000/api/pool-manager/delete-pool"
        );

        const requestWithBody = new Request(request.url, {
          method: "DELETE",
          headers: request.headers,
          body: JSON.stringify({ name: "test-pool" }),
        });

        const response = await DeletePoolDELETE(requestWithBody as any);

        await expectUnauthorized(response);
        expect(poolApi.deletePoolApi).not.toHaveBeenCalled();
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 400 for missing pool name", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        const request = createDeleteRequest(
          "http://localhost:3000/api/pool-manager/delete-pool"
        );

        const requestWithBody = new Request(request.url, {
          method: "DELETE",
          headers: request.headers,
          body: JSON.stringify({}), // Missing name
        });

        const response = await DeletePoolDELETE(requestWithBody as any);

        await expectError(response, "Missing required field: name", 400);
        expect(poolApi.deletePoolApi).not.toHaveBeenCalled();
      });
    });

    describe("External service error scenarios", () => {
      test("should handle Pool Manager API failure", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock Pool Manager API failure
        vi.spyOn(poolApi, "deletePoolApi").mockRejectedValue({
          message: "Pool not found",
          status: 404,
          service: "poolManager",
          details: { poolName: "nonexistent-pool" },
        });

        const request = createDeleteRequest(
          "http://localhost:3000/api/pool-manager/delete-pool"
        );

        const requestWithBody = new Request(request.url, {
          method: "DELETE",
          headers: request.headers,
          body: JSON.stringify({ name: "nonexistent-pool" }),
        });

        const response = await DeletePoolDELETE(requestWithBody as any);
        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.error).toBe("Pool not found");
        expect(data.service).toBe("poolManager");
        expect(data.details).toEqual({ poolName: "nonexistent-pool" });
      });

      test("should handle generic errors gracefully", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock unexpected error
        vi.spyOn(poolApi, "deletePoolApi").mockRejectedValue(
          new Error("Unexpected error")
        );

        const request = createDeleteRequest(
          "http://localhost:3000/api/pool-manager/delete-pool"
        );

        const requestWithBody = new Request(request.url, {
          method: "DELETE",
          headers: request.headers,
          body: JSON.stringify({ name: "test-pool" }),
        });

        const response = await DeletePoolDELETE(requestWithBody as any);
        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.error).toBe("Failed to delete pool");
      });
    });
  });

  describe("GET /api/w/[slug]/pool/status", () => {
    describe("Success scenarios", () => {
      test("should return pool status successfully", async () => {
        const { testUser, testWorkspace, testSwarm } = await createTestSwarmScenario();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock successful Pool Manager API response
        const mockPoolStatus = {
          status: {
            runningVms: 3,
            pendingVms: 1,
            failedVms: 0,
            usedVms: 2,
            unusedVms: 1,
            lastCheck: "2024-01-01T00:00:00Z",
          },
        };

        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            status: {
              running_vms: 3,
              pending_vms: 1,
              failed_vms: 0,
              used_vms: 2,
              unused_vms: 1,
              last_check: "2024-01-01T00:00:00Z",
            },
          }),
        });

        const request = createGetRequest(
          `http://localhost:3000/api/w/${testWorkspace.slug}/pool/status`
        );

        const response = await GetPoolStatusGET(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        const data = await expectSuccess(response);

        expect(data.success).toBe(true);
        expect(data.data).toEqual(mockPoolStatus);

        // Verify fetch was called with correct parameters
        expect(fetch).toHaveBeenCalledWith(
          expect.stringContaining(`/pools/${testSwarm.id}`),
          expect.objectContaining({
            method: "GET",
            headers: expect.objectContaining({
              "Content-Type": "application/json",
              Authorization: expect.stringContaining("Bearer"),
            }),
          })
        );
      });

      test("should handle pool status fetch failure gracefully", async () => {
        const { testUser, testWorkspace } = await createTestSwarmScenario();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock fetch failure
        global.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        });

        const request = createGetRequest(
          `http://localhost:3000/api/w/${testWorkspace.slug}/pool/status`
        );

        const response = await GetPoolStatusGET(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        const data = await response.json();

        expect(response.status).toBe(503);
        expect(data.success).toBe(false);
        expect(data.message).toBeDefined();
      });
    });

    describe("Authentication and authorization scenarios", () => {
      test("should return 401 for unauthenticated user", async () => {
        getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

        const request = createGetRequest(
          "http://localhost:3000/api/w/test-workspace/pool/status"
        );

        const response = await GetPoolStatusGET(request, {
          params: Promise.resolve({ slug: "test-workspace" }),
        });

        await expectUnauthorized(response);
      });

      test("should return 401 for session without user id", async () => {
        getMockedSession().mockResolvedValue({
          user: { email: "test@example.com" }, // Missing id
        });

        const request = createGetRequest(
          "http://localhost:3000/api/w/test-workspace/pool/status"
        );

        const response = await GetPoolStatusGET(request, {
          params: Promise.resolve({ slug: "test-workspace" }),
        });

        await expectUnauthorized(response);
      });

      test("should return 403 for user without workspace access", async () => {
        const { testWorkspace } = await createTestSwarmScenario();

        // Create different user without access
        const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

        const request = createGetRequest(
          `http://localhost:3000/api/w/${testWorkspace.slug}/pool/status`
        );

        const response = await GetPoolStatusGET(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.error).toBe("Workspace not found or access denied");
      });
    });

    describe("Input validation scenarios", () => {
      test("should return 400 for missing workspace slug", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        const request = createGetRequest(
          "http://localhost:3000/api/w//pool/status"
        );

        const response = await GetPoolStatusGET(request, {
          params: Promise.resolve({ slug: "" }),
        });

        const data = await response.json();

        expect(response.status).toBe(400);
        expect(data.error).toBe("Workspace slug is required");
      });

      test("should return 404 when workspace has no swarm", async () => {
        const testUser = await createTestUser();
        const testWorkspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "No Swarm Workspace",
          slug: generateUniqueId("workspace"),
        });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        const request = createGetRequest(
          `http://localhost:3000/api/w/${testWorkspace.slug}/pool/status`
        );

        const response = await GetPoolStatusGET(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Pool not configured for this workspace");
      });

      test("should return 404 when swarm has no poolApiKey", async () => {
        const testUser = await createTestUser();
        const testWorkspace = await createTestWorkspace({
          ownerId: testUser.id,
          name: "Test Workspace",
          slug: generateUniqueId("workspace"),
        });

        // Create swarm without poolApiKey
        await db.swarm.create({
          data: {
            id: generateUniqueId("swarm"),
            swarmId: generateUniqueId("swarm"),
            workspaceId: testWorkspace.id,
            name: "Test Swarm",
            poolApiKey: null,
          },
        });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        const request = createGetRequest(
          `http://localhost:3000/api/w/${testWorkspace.slug}/pool/status`
        );

        const response = await GetPoolStatusGET(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        const data = await response.json();

        expect(response.status).toBe(404);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Pool not configured for this workspace");
      });
    });

    describe("External service error scenarios", () => {
      test("should handle network errors gracefully", async () => {
        const { testUser, testWorkspace } = await createTestSwarmScenario();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock network error
        global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

        const request = createGetRequest(
          `http://localhost:3000/api/w/${testWorkspace.slug}/pool/status`
        );

        const response = await GetPoolStatusGET(request, {
          params: Promise.resolve({ slug: testWorkspace.slug }),
        });

        const data = await response.json();

        expect(response.status).toBe(503);
        expect(data.success).toBe(false);
        expect(data.message).toContain("Network error");
      });

      test("should handle unexpected errors with 500 status", async () => {
        const testUser = await createTestUser();

        getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

        // Mock unexpected error (simulate db error)
        vi.spyOn(db.swarm, "findFirst").mockRejectedValue(
          new Error("Database connection failed")
        );

        const request = createGetRequest(
          "http://localhost:3000/api/w/test-workspace/pool/status"
        );

        const response = await GetPoolStatusGET(request, {
          params: Promise.resolve({ slug: "test-workspace" }),
        });

        const data = await response.json();

        expect(response.status).toBe(500);
        expect(data.success).toBe(false);
        expect(data.message).toBe("Database connection failed");
      });
    });
  });
});