import { describe, test, beforeEach, vi, expect, afterEach } from "vitest";
import { POST } from "@/app/api/pool-manager/create-pool/route";
import {
  createAuthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
  expectForbidden,
  createPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspaceScenario,
  createTestSwarm,
  createTestRepository,
} from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import type { User, Workspace, Swarm, Repository } from "@prisma/client";

// Mock dependencies
vi.mock("@/lib/service-factory", () => ({
  poolManagerService: vi.fn(),
}));

vi.mock("@/auth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/services/swarm/db", () => ({
  saveOrUpdateSwarm: vi.fn(),
}));

vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn(),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));

import { poolManagerService } from "@/lib/service-factory";
import { getGithubUsernameAndPAT } from "@/auth";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } from "@/services/swarm/secrets";

const mockPoolManagerService = vi.mocked(poolManagerService);
const mockGetGithubUsernameAndPAT = vi.mocked(getGithubUsernameAndPAT);
const mockSaveOrUpdateSwarm = vi.mocked(saveOrUpdateSwarm);
const mockGetSwarmPoolApiKeyFor = vi.mocked(getSwarmPoolApiKeyFor);
const mockUpdateSwarmPoolApiKeyFor = vi.mocked(updateSwarmPoolApiKeyFor);

describe("POST /api/pool-manager/create-pool", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;
  const encryptionService = EncryptionService.getInstance();

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test scenario
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Pool Create Owner", email: "owner@test.com" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    // Create repository
    repository = await createTestRepository({
      workspaceId: workspace.id,
      repositoryUrl: "https://github.com/test/repo",
      branch: "main",
    });

    // Create swarm
    const swarmId = generateUniqueId("swarm");
    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `test-swarm-${swarmId}`,
      swarmId: swarmId,
      status: "ACTIVE",
    });

    // Setup default mocks
    const encryptedApiKey = encryptionService.encryptField("poolApiKey", "test-api-key");
    mockGetSwarmPoolApiKeyFor.mockResolvedValue(JSON.stringify(encryptedApiKey));
    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "test-github-token",
    });
    mockSaveOrUpdateSwarm.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 when not authenticated", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        { swarmId: swarm.swarmId, workspaceId: workspace.id }
      );
      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        { swarmId: swarm.swarmId, workspaceId: workspace.id }
      );
      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("returns 401 when session.user has no email", async () => {
      const session = createAuthenticatedSession(owner);
      session.user.email = null as any;
      getMockedSession().mockResolvedValue(session);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        { swarmId: swarm.swarmId, workspaceId: workspace.id }
      );
      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("returns 401 when session.user has no id", async () => {
      const session = createAuthenticatedSession(owner);
      delete (session.user as any).id;
      getMockedSession().mockResolvedValue(session);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        { swarmId: swarm.swarmId, workspaceId: workspace.id }
      );
      const response = await POST(request);

      await expectError(response, "Invalid user session", 401);
    });
  });

  describe("Authorization", () => {
    test("returns 404 when swarm not found", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        { swarmId: "nonexistent-swarm-id", workspaceId: workspace.id }
      );
      const response = await POST(request);

      await expectNotFound(response, "Swarm not found");
    });

    test("returns 403 when user is not owner or member", async () => {
      const nonMember = await createTestUser({ email: "nonmember@test.com" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        { swarmId: swarm.swarmId, workspaceId: workspace.id }
      );
      const response = await POST(request);

      await expectForbidden(response, "Access denied");
    });

    test("allows workspace owner to create pool", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockPool = {
        id: "pool-123",
        name: swarm.id,
        status: "active" as const,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockPoolManagerService.mockReturnValue({
        createPool: vi.fn().mockResolvedValue(mockPool),
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: { ".devcontainer/devcontainer.json": "{}" },
        }
      );
      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.pool).toEqual(mockPool);
    });

    test("allows workspace member to create pool", async () => {
      const member = await createTestUser({ email: "member@test.com" });
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      const mockPool = {
        id: "pool-456",
        name: swarm.id,
        status: "active" as const,
        owner_id: member.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockPoolManagerService.mockReturnValue({
        createPool: vi.fn().mockResolvedValue(mockPool),
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: { ".devcontainer/devcontainer.json": "{}" },
        }
      );
      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.pool).toEqual(mockPool);
    });
  });

  describe("Successful Pool Creation", () => {
    test("successfully creates pool with new container files", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const containerFiles = {
        ".devcontainer/devcontainer.json": '{"name": "test"}',
      };

      const mockPool = {
        id: "pool-789",
        name: swarm.id,
        status: "active" as const,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockCreatePool = vi.fn().mockResolvedValue(mockPool);
      mockPoolManagerService.mockReturnValue({
        createPool: mockCreatePool,
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: containerFiles,
        }
      );
      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.pool).toEqual(mockPool);
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          pool_name: swarm.id,
          minimum_vms: 2,
          repo_name: repository.repositoryUrl,
          branch_name: repository.branch,
          github_pat: "test-github-token",
          github_username: "testuser",
          container_files: containerFiles,
        })
      );
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          containerFiles: containerFiles,
        })
      );
    });

    test("uses existing container files if they exist in swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const existingContainerFiles = {
        ".devcontainer/devcontainer.json": '{"name": "existing"}',
      };

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          containerFiles: existingContainerFiles,
        },
      });

      const newContainerFiles = {
        ".devcontainer/devcontainer.json": '{"name": "new"}',
      };

      const mockPool = {
        id: "pool-101",
        name: swarm.id,
        status: "active" as const,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockCreatePool = vi.fn().mockResolvedValue(mockPool);
      mockPoolManagerService.mockReturnValue({
        createPool: mockCreatePool,
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: newContainerFiles,
        }
      );
      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.pool).toEqual(mockPool);
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          container_files: existingContainerFiles,
        })
      );
    });

    test("updates swarm state to COMPLETE on success", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockPool = {
        id: "pool-202",
        name: swarm.id,
        status: "active" as const,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockPoolManagerService.mockReturnValue({
        createPool: vi.fn().mockResolvedValue(mockPool),
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectSuccess(response, 201);
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          poolState: "COMPLETE",
        })
      );
    });

    test("calls service with correct parameters including environment variables", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const envVars = [
        { name: "TEST_VAR", value: "test-value" },
        { name: "ANOTHER_VAR", value: "another-value" },
      ];

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          environmentVariables: JSON.stringify(envVars),
        },
      });

      const mockPool = {
        id: "pool-303",
        name: swarm.id,
        status: "active" as const,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const mockCreatePool = vi.fn().mockResolvedValue(mockPool);
      mockPoolManagerService.mockReturnValue({
        createPool: mockCreatePool,
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectSuccess(response, 201);
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          env_vars: expect.arrayContaining([
            expect.objectContaining({ name: "TEST_VAR", value: "test-value" }),
            expect.objectContaining({ name: "ANOTHER_VAR", value: "another-value" }),
          ]),
        })
      );
    });
  });

  describe("Service Error Handling", () => {
    test("handles 404 error from external service", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const apiError = {
        status: 404,
        service: "pool-manager",
        message: "Repository not found",
        details: { repo: repository.repositoryUrl },
      };

      mockPoolManagerService.mockReturnValue({
        createPool: vi.fn().mockRejectedValue(apiError),
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectError(response, "Repository not found", 404);
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          poolState: "FAILED",
        })
      );
    });

    test("handles 403 forbidden error from service", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const apiError = {
        status: 403,
        service: "pool-manager",
        message: "Insufficient permissions",
      };

      mockPoolManagerService.mockReturnValue({
        createPool: vi.fn().mockRejectedValue(apiError),
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectError(response, "Insufficient permissions", 403);
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          poolState: "FAILED",
        })
      );
    });

    test("handles 500 service unavailable error", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const apiError = {
        status: 500,
        service: "pool-manager",
        message: "Internal server error",
      };

      mockPoolManagerService.mockReturnValue({
        createPool: vi.fn().mockRejectedValue(apiError),
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectError(response, "Internal server error", 500);
    });

    test("handles 401 invalid API key error", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const apiError = {
        status: 401,
        service: "pool-manager",
        message: "Invalid or expired API key",
      };

      mockPoolManagerService.mockReturnValue({
        createPool: vi.fn().mockRejectedValue(apiError),
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectError(response, "Invalid or expired API key", 401);
    });

    test("handles generic errors without ApiError structure", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockPoolManagerService.mockReturnValue({
        createPool: vi.fn().mockRejectedValue(new Error("Network timeout")),
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectError(response, "Failed to create pool", 500);
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          poolState: "FAILED",
        })
      );
    });
  });

  describe("Data Handling", () => {
    test("properly retrieves and uses GitHub credentials", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "custom-github-user",
        token: "custom-github-token",
      });

      const mockCreatePool = vi.fn().mockResolvedValue({
        id: "pool-404",
        name: swarm.id,
        status: "active" as const,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      mockPoolManagerService.mockReturnValue({
        createPool: mockCreatePool,
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectSuccess(response, 201);
      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledWith(
        owner.id,
        workspace.slug
      );
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          github_username: "custom-github-user",
          github_pat: "custom-github-token",
        })
      );
    });

    test("properly retrieves poolApiKey from swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const testApiKey = "secure-test-api-key";
      const encryptedApiKey = encryptionService.encryptField("poolApiKey", testApiKey);
      mockGetSwarmPoolApiKeyFor.mockResolvedValue(JSON.stringify(encryptedApiKey));

      const mockCreatePool = vi.fn().mockResolvedValue({
        id: "pool-505",
        name: swarm.id,
        status: "active" as const,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      mockPoolManagerService.mockReturnValue({
        createPool: mockCreatePool,
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectSuccess(response, 201);
      expect(mockGetSwarmPoolApiKeyFor).toHaveBeenCalledWith(swarm.id);
    });

    test("updates poolApiKey if not found", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockGetSwarmPoolApiKeyFor
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          JSON.stringify(encryptionService.encryptField("poolApiKey", "new-api-key"))
        );

      mockPoolManagerService.mockReturnValue({
        createPool: vi.fn().mockResolvedValue({
          id: "pool-606",
          name: swarm.id,
          status: "active" as const,
          owner_id: owner.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectSuccess(response, 201);
      expect(mockUpdateSwarmPoolApiKeyFor).toHaveBeenCalledWith(swarm.id);
      expect(mockGetSwarmPoolApiKeyFor).toHaveBeenCalledTimes(2);
    });

    test("properly handles repository lookup", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockCreatePool = vi.fn().mockResolvedValue({
        id: "pool-707",
        name: swarm.id,
        status: "active" as const,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      mockPoolManagerService.mockReturnValue({
        createPool: mockCreatePool,
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectSuccess(response, 201);
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          repo_name: repository.repositoryUrl,
          branch_name: repository.branch,
        })
      );
    });
  });

  describe("Edge Cases", () => {
    test("handles workspace without repository", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      await db.repository.delete({
        where: { id: repository.id },
      });

      const mockCreatePool = vi.fn().mockResolvedValue({
        id: "pool-808",
        name: swarm.id,
        status: "active" as const,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      mockPoolManagerService.mockReturnValue({
        createPool: mockCreatePool,
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectSuccess(response, 201);
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          repo_name: "",
          branch_name: "",
        })
      );
    });

    test("handles empty container files", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockCreatePool = vi.fn().mockResolvedValue({
        id: "pool-909",
        name: swarm.id,
        status: "active" as const,
        owner_id: owner.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      mockPoolManagerService.mockReturnValue({
        createPool: mockCreatePool,
        updateApiKey: vi.fn(),
      } as any);

      const request = createPostRequest(
        "http://localhost/api/pool-manager/create-pool",
        {
          swarmId: swarm.swarmId,
          workspaceId: workspace.id,
          container_files: {},
        }
      );
      const response = await POST(request);

      await expectSuccess(response, 201);
      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          containerFiles: {},
        })
      );
    });
  });
});