import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/pool-manager/create-pool/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import { resetDatabase } from "@/__tests__/support/fixtures/database";
import { createPostRequest } from "@/__tests__/support/helpers/request-builders";
import { getMockedSession, createAuthenticatedSession } from "@/__tests__/support/helpers/auth";

// Mock PoolManagerService class
const mockPoolManagerService = {
  createPool: vi.fn(),
  getPoolStatus: vi.fn(),
};

vi.mock("@/services/pool-manager/PoolManagerService", () => {
  return {
    PoolManagerService: vi.fn().mockImplementation(() => mockPoolManagerService),
  };
});

vi.mock("@/lib/encryption", () => {
  const mockEncryptionService = {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn((field: string, value: string) => 
        JSON.stringify({
          data: Buffer.from(value).toString("base64"),
          iv: "mock-iv",
          tag: "mock-tag",
          keyId: "test-key",
          version: "1",
          encryptedAt: new Date().toISOString(),
        })
      ),
      decryptField: vi.fn((field: string, encryptedData: any) => {
        if (typeof encryptedData === "string") {
          try {
            const parsed = JSON.parse(encryptedData);
            return Buffer.from(parsed.data, "base64").toString("utf8");
          } catch {
            return encryptedData;
          }
        }
        return "decrypted-value";
      }),
    })),
  };
  return {
    EncryptionService: mockEncryptionService,
    encryptEnvVars: vi.fn((vars: Array<{ name: string; value: string }>) => 
      vars.map(v => ({
        name: v.name,
        value: {
          data: Buffer.from(v.value).toString("base64"),
          iv: "mock-iv",
          tag: "mock-tag",
          version: "1",
          encryptedAt: new Date().toISOString(),
        },
      }))
    ),
    decryptEnvVars: vi.fn((vars: Array<{ name: string; value: any }>) => 
      vars.map(v => ({
        name: v.name,
        value: typeof v.value === "object" && v.value.data 
          ? Buffer.from(v.value.data, "base64").toString("utf8")
          : v.value,
      }))
    ),
  };
});

vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn(),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(async () => ({
    token: "mock-github-pat",
    username: "mock-github-user",
  })),
}));

describe("POST /api/pool-manager/create-pool", () => {
  let mockGetSwarmPoolApiKeyFor: any;
  let mockUpdateSwarmPoolApiKeyFor: any;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    // Reset mock implementations
    mockPoolManagerService.createPool.mockResolvedValue({
      pool_name: "test-pool",
      owner_username: "admin",
      minimum_vms: 2,
    });

    mockPoolManagerService.getPoolStatus.mockResolvedValue({
      status: {
        runningVms: 2,
        pendingVms: 0,
        failedVms: 0,
        usedVms: 0,
        unusedVms: 2,
        lastCheck: new Date().toISOString(),
      },
    });

    // Setup swarm secrets mocks
    const secrets = await import("@/services/swarm/secrets");
    mockGetSwarmPoolApiKeyFor = vi.mocked(secrets.getSwarmPoolApiKeyFor);
    mockUpdateSwarmPoolApiKeyFor = vi.mocked(secrets.updateSwarmPoolApiKeyFor);
    
    mockGetSwarmPoolApiKeyFor.mockResolvedValue(
      JSON.stringify({
        data: Buffer.from("test-api-key").toString("base64"),
        iv: "mock-iv",
        tag: "mock-tag",
        version: "1",
        encryptedAt: new Date().toISOString(),
      })
    );
  });

  describe("Authentication", () => {
    it("should return 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: "test-swarm-id",
        workspaceId: "test-workspace-id",
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: "test-swarm-id",
        workspaceId: "test-workspace-id",
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when user has no email", async () => {
      const user = await db.user.create({
        data: {
          id: "test-user-id",
          name: "Test User",
          email: null,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession({ ...user, email: null })
      );

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: "test-swarm-id",
        workspaceId: "test-workspace-id",
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session has no userId", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com", name: "Test User" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: "test-swarm-id",
        workspaceId: "test-workspace-id",
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Authorization", () => {
    it("should return 403 when user is not owner or member of workspace", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      // Create different user who is not a member
      const unauthorizedUser = await db.user.create({
        data: {
          id: "unauthorized-user-id",
          email: "unauthorized@example.com",
          name: "Unauthorized User",
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(unauthorizedUser)
      );

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });

    it("should allow owner to create pool", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {
          "devcontainer.json": "base64-encoded-content",
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });

    it("should allow workspace member to create pool", async () => {
      const { workspace, swarm, owner, members } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
        members: [
          {
            role: "DEVELOPER",
            user: {
              email: "member@example.com",
              name: "Member User",
            },
          },
        ],
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(members[0]));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {
          "devcontainer.json": "base64-encoded-content",
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
    });
  });

  describe("Input Validation", () => {
    it("should return 404 when swarm is not found", async () => {
      const { owner } = await createTestWorkspaceScenario({
        withSwarm: false,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: "non-existent-swarm-id",
        workspaceId: "test-workspace-id",
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found");
    });

    it("should return 404 when workspace is not found", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Use a non-existent workspaceId
      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: "non-existent-swarm",
        workspaceId: "non-existent-workspace-id",
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found");
    });

    it("should return 400 when swarm.id is missing", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: false,
      });

      // Create swarm without id (simulate missing required field)
      const swarm = await db.swarm.create({
        data: {
          id: "",
          swarmId: "test-swarm-id",
          name: "test-swarm",
          workspaceId: workspace.id,
          status: "ACTIVE",
          instanceType: "t2.micro",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm.swarmId,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Missing required field: name");
    });
  });

  describe("Business Logic", () => {
    it("should create pool with correct parameters", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      // Set environment variables on swarm
      await db.swarm.update({
        where: { id: swarm!.id },
        data: {
          environmentVariables: JSON.stringify([
            { name: "TEST_ENV", value: "test-value" },
          ]),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {
          "devcontainer.json": "base64-encoded-devcontainer",
          "Dockerfile": "base64-encoded-dockerfile",
          "docker-compose.yml": "base64-encoded-compose",
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(mockPoolManagerService.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          pool_name: swarm!.id,
          minimum_vms: 2,
          repo_name: "https://github.com/test/repo",
          branch_name: "main",
          github_pat: "mock-github-pat",
          github_username: "mock-github-user",
          env_vars: expect.any(Array),
          container_files: expect.objectContaining({
            "devcontainer.json": "base64-encoded-devcontainer",
            "Dockerfile": "base64-encoded-dockerfile",
            "docker-compose.yml": "base64-encoded-compose",
          }),
        })
      );
    });

    it("should use existing container files if already saved", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      // Set existing container files on swarm
      const existingContainerFiles = {
        "devcontainer.json": "existing-devcontainer",
        "Dockerfile": "existing-dockerfile",
      };

      await db.swarm.update({
        where: { id: swarm!.id },
        data: {
          containerFiles: existingContainerFiles,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {
          "devcontainer.json": "new-devcontainer",
          "Dockerfile": "new-dockerfile",
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPoolManagerService.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          container_files: existingContainerFiles,
        })
      );
    });

    it("should save new container files if none exist", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const newContainerFiles = {
        "devcontainer.json": "new-devcontainer",
        "Dockerfile": "new-dockerfile",
      };

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: newContainerFiles,
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      // Verify container files were saved to database
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm!.id },
      });
      expect(updatedSwarm!.containerFiles).toEqual(newContainerFiles);
    });

    it("should retrieve and decrypt poolApiKey from swarm", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {},
      });

      await POST(request);

      expect(mockGetSwarmPoolApiKeyFor).toHaveBeenCalledWith(swarm!.id);
    });

    it("should generate poolApiKey if none exists", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      // Mock poolApiKey not found initially
      mockGetSwarmPoolApiKeyFor
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce(
          JSON.stringify({
            data: Buffer.from("generated-api-key").toString("base64"),
            iv: "mock-iv",
            tag: "mock-tag",
            version: "1",
            encryptedAt: new Date().toISOString(),
          })
        );

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {},
      });

      await POST(request);

      expect(mockUpdateSwarmPoolApiKeyFor).toHaveBeenCalledWith(swarm!.id);
      expect(mockGetSwarmPoolApiKeyFor).toHaveBeenCalledTimes(2);
    });

    it("should decrypt environment variables before sending to Pool Manager", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      // Set encrypted environment variables
      await db.swarm.update({
        where: { id: swarm!.id },
        data: {
          environmentVariables: JSON.stringify([
            {
              name: "SECRET_KEY",
              value: {
                data: Buffer.from("secret-value").toString("base64"),
                iv: "mock-iv",
                tag: "mock-tag",
                version: "1",
                encryptedAt: new Date().toISOString(),
              },
            },
          ]),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {},
      });

      await POST(request);

      expect(mockPoolManagerService.createPool).toHaveBeenCalledWith(
        expect.objectContaining({
          env_vars: expect.arrayContaining([
            expect.objectContaining({
              name: "SECRET_KEY",
              value: expect.any(String),
            }),
          ]),
        })
      );
    });

    it("should update poolState to COMPLETE on success", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {},
      });

      await POST(request);

      // Wait a bit for async saveOrUpdateSwarm to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm!.id },
      });

      expect(updatedSwarm!.poolState).toBe("COMPLETE");
      expect(updatedSwarm!.poolName).toBe(swarm!.swarmId);
    });
  });

  describe("Retry Logic", () => {
    it("should retry pool creation up to 3 times on failure", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      // Mock failures followed by success
      mockPoolManagerService.createPool
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          pool_name: "test-pool",
          owner_username: "admin",
          minimum_vms: 2,
        });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockPoolManagerService.createPool).toHaveBeenCalledTimes(3);
    });

    it("should fail after 3 retry attempts", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      // Mock continuous failures
      mockPoolManagerService.createPool.mockRejectedValue(
        new Error("Persistent network error")
      );

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      expect(mockPoolManagerService.createPool).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });
  });

  describe("Error Handling", () => {
    it("should preserve ApiError details in response", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      const apiError = {
        message: "Invalid pool configuration",
        status: 422,
        service: "poolManager",
        details: {
          field: "minimum_vms",
          reason: "Must be at least 1",
        },
      };

      mockPoolManagerService.createPool.mockRejectedValue(apiError);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(422);
      expect(data.error).toBe("Invalid pool configuration");
      expect(data.service).toBe("poolManager");
      expect(data.details).toEqual({
        field: "minimum_vms",
        reason: "Must be at least 1",
      });
    });

    it("should return generic 500 error for non-ApiError exceptions", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      // Mock a TypeError to simulate non-ApiError exceptions
      const typeError = new TypeError("Cannot read property 'x' of undefined");
      mockPoolManagerService.createPool.mockRejectedValue(typeError);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {},
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create pool");
    });

    it("should update poolState to FAILED on error", async () => {
      const { workspace, swarm, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          status: "ACTIVE",
        },
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          workspaceId: workspace.id,
        },
      });

      // Mock rejection with a non-ApiError error
      const genericError = new Error("Pool creation failed");
      mockPoolManagerService.createPool.mockRejectedValue(genericError);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest("/api/pool-manager/create-pool", {
        swarmId: swarm!.swarmId,
        workspaceId: workspace.id,
        container_files: {},
      });

      await POST(request);

      // Wait a bit for async saveOrUpdateSwarm to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm!.id },
      });

      expect(updatedSwarm!.poolState).toBe("FAILED");
    });
  });
});