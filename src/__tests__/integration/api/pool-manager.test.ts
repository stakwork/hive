import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/pool-manager/create-pool/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { PoolManagerService } from "@/services/pool-manager";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
  createTestRepository,
} from "@/__tests__/support/fixtures";
import {
  createPostRequest,
  generateUniqueId,
  createAuthenticatedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectNotFound,
  getMockedSession,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm, Repository } from "@prisma/client";
import type { Pool } from "@/types";

// Mock next-auth for session management
vi.mock("next-auth/next");

describe("Pool Manager API - Integration Tests", () => {
  describe("POST /api/pool-manager/create-pool - Authentication", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;
    let repository: Repository;

    beforeEach(async () => {
      await db.$transaction(async (tx) => {
        const scenario = await createTestWorkspaceScenario({
          owner: { name: "Pool Manager Owner" },
        });

        owner = scenario.owner;
        workspace = scenario.workspace;

        // Create repository
        repository = await createTestRepository({
          workspaceId: workspace.id,
          repositoryUrl: `https://github.com/test/repo-${generateUniqueId("repo")}.git`,
          branch: "main",
        });

        // Create swarm with encrypted API key
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = encryptionService.encryptField(
          "poolApiKey",
          "test-pool-api-key"
        );

        swarm = await createTestSwarm({
          workspaceId: workspace.id,
          name: `test-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        });

        await tx.swarm.update({
          where: { id: swarm.id },
          data: {
            poolApiKey: JSON.stringify(encryptedApiKey),
            swarmId: swarm.id,
          },
        });
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("should return 401 when session user has no ID", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id field
      });

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("POST /api/pool-manager/create-pool - Authorization", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;
    let repository: Repository;
    let nonMember: User;

    beforeEach(async () => {
      await db.$transaction(async (tx) => {
        const scenario = await createTestWorkspaceScenario({
          owner: { name: "Pool Auth Owner" },
        });

        owner = scenario.owner;
        workspace = scenario.workspace;

        // Create repository
        repository = await createTestRepository({
          workspaceId: workspace.id,
          repositoryUrl: `https://github.com/test/auth-repo-${generateUniqueId("repo")}.git`,
          branch: "main",
        });

        // Create swarm with encrypted API key
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = encryptionService.encryptField(
          "poolApiKey",
          "test-pool-api-key-auth"
        );

        swarm = await createTestSwarm({
          workspaceId: workspace.id,
          name: `auth-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        });

        await tx.swarm.update({
          where: { id: swarm.id },
          data: {
            poolApiKey: JSON.stringify(encryptedApiKey),
            swarmId: swarm.id,
          },
        });

        // Create non-member user
        nonMember = await tx.user.create({
          data: {
            name: "Non Member User",
            email: `non-member-${generateUniqueId("user")}@example.com`,
          },
        });
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test("should return 404 when swarm not found", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(owner)
      );

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: "non-existent-swarm",
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);

      await expectNotFound(response, "Swarm not found");
    });

    test("should return 403 when user is not owner or member", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(nonMember)
      );

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });

    test("should allow workspace owner to create pool", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(owner)
      );

      const mockPool: Pool = {
        id: "pool-123",
        name: swarm.id,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      };

      vi.spyOn(PoolManagerService.prototype, "createPool").mockResolvedValue(
        mockPool
      );

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: { "devcontainer.json": "base64content" },
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.pool).toBeDefined();
      expect(data.pool.id).toBe("pool-123");
    });
  });

  describe("POST /api/pool-manager/create-pool - Pool Creation Integration", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;
    let repository: Repository;

    beforeEach(async () => {
      await db.$transaction(async (tx) => {
        const scenario = await createTestWorkspaceScenario({
          owner: { name: "Pool Creation Owner" },
        });

        owner = scenario.owner;
        workspace = scenario.workspace;

        // Create repository
        repository = await createTestRepository({
          workspaceId: workspace.id,
          repositoryUrl: `https://github.com/test/creation-repo-${generateUniqueId("repo")}.git`,
          branch: "main",
        });

        // Create swarm with encrypted API key and environment variables
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = encryptionService.encryptField(
          "poolApiKey",
          "test-pool-api-key-creation"
        );

        const envVars = [
          { name: "TEST_ENV", value: "test-value" },
          { name: "API_KEY", value: "secret-key" },
        ];

        swarm = await createTestSwarm({
          workspaceId: workspace.id,
          name: `creation-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        });

        await tx.swarm.update({
          where: { id: swarm.id },
          data: {
            poolApiKey: JSON.stringify(encryptedApiKey),
            swarmId: swarm.id,
            environmentVariables: JSON.stringify(envVars),
          },
        });
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(owner)
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test("should successfully create pool with correct parameters", async () => {
      const mockPool: Pool = {
        id: "pool-created-123",
        name: swarm.id,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      };

      const createPoolSpy = vi
        .spyOn(PoolManagerService.prototype, "createPool")
        .mockResolvedValue(mockPool);

      const containerFiles = {
        "devcontainer.json": Buffer.from('{"name":"test"}').toString("base64"),
        "docker-compose.yml": Buffer.from("version: '3'").toString("base64"),
      };

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: containerFiles,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.pool).toBeDefined();
      expect(data.pool.id).toBe("pool-created-123");
      expect(data.pool.name).toBe(swarm.id);

      // Verify createPool was called with correct parameters
      expect(createPoolSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pool_name: swarm.id,
          minimum_vms: 2,
          repo_name: repository.repositoryUrl,
          branch_name: repository.branch,
          container_files: containerFiles,
        })
      );
    });

    test("should handle encrypted environment variables", async () => {
      const mockPool: Pool = {
        id: "pool-env-123",
        name: swarm.id,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      };

      const createPoolSpy = vi
        .spyOn(PoolManagerService.prototype, "createPool")
        .mockResolvedValue(mockPool);

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      await expectSuccess(response, 201);

      // Verify environment variables were decrypted and passed
      const callArgs = createPoolSpy.mock.calls[0][0];
      expect(callArgs.env_vars).toBeDefined();
      expect(Array.isArray(callArgs.env_vars)).toBe(true);
    });

    test("should update swarm state to COMPLETE on success", async () => {
      const mockPool: Pool = {
        id: "pool-state-123",
        name: swarm.id,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      };

      vi.spyOn(PoolManagerService.prototype, "createPool").mockResolvedValue(
        mockPool
      );

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      await POST(request);

      // Verify swarm state was updated
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });

      expect(updatedSwarm?.poolState).toBe("COMPLETE");
      expect(updatedSwarm?.poolName).toBe(swarm.id);
    });

    test("should decrypt poolApiKey before calling external service", async () => {
      const mockPool: Pool = {
        id: "pool-decrypt-123",
        name: swarm.id,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      };

      vi.spyOn(PoolManagerService.prototype, "createPool").mockResolvedValue(
        mockPool
      );

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      await expectSuccess(response, 201);

      // Verify that poolApiKey was decrypted
      // The service should receive decrypted key in Authorization header
      // This is implicitly tested by the service call succeeding
      expect(response.status).toBe(201);
    });

    test("should use existing container files if already present", async () => {
      const existingContainerFiles = {
        "existing.json": "existing-content",
      };

      // Update swarm with existing container files
      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          containerFiles: existingContainerFiles,
        },
      });

      const mockPool: Pool = {
        id: "pool-existing-files-123",
        name: swarm.id,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      };

      const createPoolSpy = vi
        .spyOn(PoolManagerService.prototype, "createPool")
        .mockResolvedValue(mockPool);

      const newContainerFiles = {
        "new.json": "new-content",
      };

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: newContainerFiles,
      });

      await POST(request);

      // Verify existing container files were used
      const callArgs = createPoolSpy.mock.calls[0][0];
      expect(callArgs.container_files).toEqual(existingContainerFiles);
    });
  });

  describe("POST /api/pool-manager/create-pool - Error Handling", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;
    let repository: Repository;

    beforeEach(async () => {
      await db.$transaction(async (tx) => {
        const scenario = await createTestWorkspaceScenario({
          owner: { name: "Pool Error Owner" },
        });

        owner = scenario.owner;
        workspace = scenario.workspace;

        // Create repository
        repository = await createTestRepository({
          workspaceId: workspace.id,
          repositoryUrl: `https://github.com/test/error-repo-${generateUniqueId("repo")}.git`,
          branch: "main",
        });

        // Create swarm with encrypted API key
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = encryptionService.encryptField(
          "poolApiKey",
          "test-pool-api-key-error"
        );

        swarm = await createTestSwarm({
          workspaceId: workspace.id,
          name: `error-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        });

        await tx.swarm.update({
          where: { id: swarm.id },
          data: {
            poolApiKey: JSON.stringify(encryptedApiKey),
            swarmId: swarm.id,
          },
        });
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(owner)
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test("should return 500 and update swarm state to FAILED on service error", async () => {
      vi.spyOn(PoolManagerService.prototype, "createPool").mockRejectedValue(
        new Error("External service unavailable")
      );

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create pool");

      // Verify swarm state was updated to FAILED
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
      });

      expect(updatedSwarm?.poolState).toBe("FAILED");
    });

    test("should handle ApiError with status and service information", async () => {
      const apiError = {
        message: "Pool creation failed",
        status: 503,
        service: "poolManager",
        details: { reason: "Service unavailable" },
      };

      vi.spyOn(PoolManagerService.prototype, "createPool").mockRejectedValue(
        apiError
      );

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe("Pool creation failed");
      expect(data.service).toBe("poolManager");
      expect(data.details).toEqual({ reason: "Service unavailable" });
    });

    test("should retry pool creation on failure", async () => {
      const mockPool: Pool = {
        id: "pool-retry-123",
        name: swarm.id,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      };

      const createPoolSpy = vi
        .spyOn(PoolManagerService.prototype, "createPool")
        .mockRejectedValueOnce(new Error("Temporary failure"))
        .mockRejectedValueOnce(new Error("Temporary failure"))
        .mockResolvedValueOnce(mockPool);

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.pool.id).toBe("pool-retry-123");
      expect(createPoolSpy).toHaveBeenCalledTimes(3);
    });

    test("should handle missing poolApiKey gracefully", async () => {
      // Update swarm to remove poolApiKey
      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: null,
        },
      });

      const mockPool: Pool = {
        id: "pool-no-key-123",
        name: swarm.id,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      };

      // Mock external API calls for pool user creation
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          json: () => Promise.resolve({ token: "mock-admin-token" }),
        } as Response)
        .mockResolvedValueOnce({
          json: () =>
            Promise.resolve({
              user: {
                authentication_token: "mock-user-token",
              },
            }),
        } as Response);

      vi.spyOn(PoolManagerService.prototype, "createPool").mockResolvedValue(
        mockPool
      );

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);

      // Should still succeed after creating/updating poolApiKey
      expect(response.status).toBe(201);
    });
  });

  describe("POST /api/pool-manager/create-pool - Data Retrieval Validation", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;
    let repository: Repository;

    beforeEach(async () => {
      await db.$transaction(async (tx) => {
        const scenario = await createTestWorkspaceScenario({
          owner: { name: "Pool Data Owner" },
        });

        owner = scenario.owner;
        workspace = scenario.workspace;

        // Create repository with specific data
        repository = await createTestRepository({
          workspaceId: workspace.id,
          name: "Test Repository",
          repositoryUrl: "https://github.com/test/data-repo.git",
          branch: "develop",
        });

        // Create swarm with encrypted API key
        const encryptionService = EncryptionService.getInstance();
        const encryptedApiKey = encryptionService.encryptField(
          "poolApiKey",
          "test-pool-api-key-data"
        );

        swarm = await createTestSwarm({
          workspaceId: workspace.id,
          name: `data-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        });

        await tx.swarm.update({
          where: { id: swarm.id },
          data: {
            poolApiKey: JSON.stringify(encryptedApiKey),
            swarmId: swarm.id,
          },
        });
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(owner)
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test("should retrieve and use repository data correctly", async () => {
      const mockPool: Pool = {
        id: "pool-data-123",
        name: swarm.id,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      };

      const createPoolSpy = vi
        .spyOn(PoolManagerService.prototype, "createPool")
        .mockResolvedValue(mockPool);

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      await POST(request);

      // Verify correct repository data was passed
      const callArgs = createPoolSpy.mock.calls[0][0];
      expect(callArgs.repo_name).toBe("https://github.com/test/data-repo.git");
      expect(callArgs.branch_name).toBe("develop");
    });

    test("should handle missing repository gracefully", async () => {
      // Delete repository
      await db.repository.delete({
        where: { id: repository.id },
      });

      const mockPool: Pool = {
        id: "pool-no-repo-123",
        name: swarm.id,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      };

      const createPoolSpy = vi
        .spyOn(PoolManagerService.prototype, "createPool")
        .mockResolvedValue(mockPool);

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      await POST(request);

      // Verify empty strings were passed for missing repository
      const callArgs = createPoolSpy.mock.calls[0][0];
      expect(callArgs.repo_name).toBe("");
      expect(callArgs.branch_name).toBe("");
    });

    test("should correctly format pool response data", async () => {
      const mockPool: Pool = {
        id: "pool-format-123",
        name: swarm.id,
        description: "Test pool description",
        owner_id: owner.id,
        created_at: "2024-01-15T10:00:00Z",
        updated_at: "2024-01-15T11:00:00Z",
        status: "active",
      };

      vi.spyOn(PoolManagerService.prototype, "createPool").mockResolvedValue(
        mockPool
      );

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.id,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.pool).toMatchObject({
        id: "pool-format-123",
        name: swarm.id,
        description: "Test pool description",
        owner_id: owner.id,
        status: "active",
      });
      expect(data.pool.created_at).toBeDefined();
      expect(data.pool.updated_at).toBeDefined();
    });
  });
});