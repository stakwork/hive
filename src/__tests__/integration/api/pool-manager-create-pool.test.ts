import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/pool-manager/create-pool/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import {
  createAuthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import type { ApiError } from "@/types";

// Mock PoolManagerService via service-factory
const mockCreatePool = vi.fn(async () => ({
  id: "pool-123",
  name: "test-pool",
  description: "Test pool",
  owner_id: "owner-123",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  status: "active" as const,
}));

vi.mock("@/lib/service-factory", () => ({
  poolManagerService: () => ({
    createPool: mockCreatePool,
    deletePool: vi.fn(),
    getPoolStatus: vi.fn(),
    updatePoolData: vi.fn(),
  }),
}));

// Mock getGithubUsernameAndPAT
vi.mock("@/lib/auth/nextauth", async () => {
  const actual = await vi.importActual("@/lib/auth/nextauth");
  return {
    ...actual,
    getGithubUsernameAndPAT: vi.fn(async () => ({
      username: "testuser",
      token: "ghp_test_token_123",
    })),
  };
});

// Mock swarm secrets functions
vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn(async (swarmId: string) => {
    // Will be overridden in tests
    return ""; 
  }),
  updateSwarmPoolApiKeyFor: vi.fn(async () => {
    // Mock implementation - in real scenario creates Pool Manager user
  }),
}));

// Get references to mocked functions
import { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
const mockGetSwarmPoolApiKeyFor = getSwarmPoolApiKeyFor as ReturnType<typeof vi.fn>;
const mockUpdateSwarmPoolApiKeyFor = updateSwarmPoolApiKeyFor as ReturnType<typeof vi.fn>;

// Mock saveOrUpdateSwarm to track poolState updates  
vi.mock("@/services/swarm/db", () => ({
  saveOrUpdateSwarm: vi.fn(async () => {}),
}));

// Get reference to mocked function
const mockSaveOrUpdateSwarm = saveOrUpdateSwarm as ReturnType<typeof vi.fn>;

describe("POST /api/pool-manager/create-pool", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_POOL_API_KEY = "pool_api_key_123";
  let workspaceId: string;
  let swarmId: string;
  let userId: string;
  let workspaceSlug: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Setup mock functions with default return values
    mockGetSwarmPoolApiKeyFor.mockImplementation(async (swarmId: string) => {
      const swarm = await db.swarm.findFirst({
        where: { id: swarmId },
        select: { poolApiKey: true },
      });
      if (swarm?.poolApiKey) {
        try {
          const parsed = JSON.parse(swarm.poolApiKey);
          return enc.decryptField("poolApiKey", parsed);
        } catch {
          return swarm.poolApiKey;
        }
      }
      return "pool_api_key_123";
    });

    mockUpdateSwarmPoolApiKeyFor.mockResolvedValue(undefined);
    mockSaveOrUpdateSwarm.mockResolvedValue(undefined);

    const testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-ws"),
          ownerId: user.id,
        },
      });

      const repository = await tx.repository.create({
        data: {
          workspaceId: workspace.id,
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          branch: "main",
          status: "SYNCED",
        },
      });

      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "test-swarm",
          status: "ACTIVE",
          swarmId: generateUniqueId("swarm"),
          swarmUrl: "https://test-swarm.sphinx.chat/api",
          poolApiKey: JSON.stringify(
            enc.encryptField("poolApiKey", PLAINTEXT_POOL_API_KEY)
          ),
          services: [],
          containerFiles: {
            "devcontainer.json": '{"name": "Test Container"}',
            "Dockerfile": "FROM node:18",
            "docker-compose.yml": "version: '3.8'",
          },
          environmentVariables: JSON.stringify([
            {
              name: "TEST_ENV",
              value: enc.encryptField("environmentVariables", "test_value"),
            },
          ]),
        },
      });

      return { user, workspace, repository, swarm };
    });

    userId = testData.user.id;
    workspaceId = testData.workspace.id;
    workspaceSlug = testData.workspace.slug;
    swarmId = testData.swarm.id;

    getMockedSession().mockResolvedValue(
      createAuthenticatedSession(testData.user)
    );
  });

  describe("Authentication & Authorization", () => {
    it("returns 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(null);

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      const res = await POST(req);
      expect(res?.status).toBe(401);
      const data = await res?.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when user session has no email", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: userId, name: "Test User" },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      const res = await POST(req);
      expect(res?.status).toBe(401);
      const data = await res?.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 403 when user is not workspace owner or member", async () => {
      // Create different user who has no access
      const otherUser = await db.user.create({
        data: {
          email: `other-${generateUniqueId()}@example.com`,
          name: "Other User",
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(otherUser)
      );

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      const res = await POST(req);
      expect(res?.status).toBe(403);
      const data = await res?.json();
      expect(data.error).toBe("Access denied");
    });
  });

  describe("Input Validation", () => {
    it("returns 404 when swarm is not found", async () => {
      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: "non-existent-swarm",
          workspaceId,
          container_files: {},
        }
      );

      const res = await POST(req);
      expect(res?.status).toBe(404);
      const data = await res?.json();
      expect(data.error).toBe("Swarm not found");
    });

    it("returns 404 when workspace is not found", async () => {
      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId: "non-existent-workspace",
          container_files: {},
        }
      );

      const res = await POST(req);
      expect(res?.status).toBe(404);
      const data = await res?.json();
      expect(data.error).toBe("Swarm not found");
    });
  });

  describe("Business Logic - Pool Creation", () => {
    it("creates pool with correct parameters and minimum_vms default of 2", async () => {
      const containerFiles = {
        "devcontainer.json": '{"name": "Test"}',
        "Dockerfile": "FROM node:18",
        "docker-compose.yml": "version: '3.8'",
      };

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: containerFiles,
        }
      );

      const res = await POST(req);
      expect(res?.status).toBe(201);

      expect(mockCreatePool).toHaveBeenCalledOnce();
      const callArgs = mockCreatePool.mock.calls[0][0];

      expect(callArgs.pool_name).toBe(swarmId);
      expect(callArgs.minimum_vms).toBe(2);
      expect(callArgs.repo_name).toBe("https://github.com/test/repo");
      expect(callArgs.branch_name).toBe("main");
      expect(callArgs.github_pat).toBe("ghp_test_token_123");
      expect(callArgs.github_username).toBe("testuser");
      expect(callArgs.env_vars).toHaveLength(1);
      expect(callArgs.env_vars[0].name).toBe("TEST_ENV");
      expect(callArgs.env_vars[0].value).toBe("test_value");
    });

    it("uses existing container files from swarm if available", async () => {
      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {
            "devcontainer.json": '{"name": "Different"}',
          },
        }
      );

      const res = await POST(req);
      expect(res?.status).toBe(201);

      const callArgs = mockCreatePool.mock.calls[0][0];
      // Should use existing container files from swarm, not the new ones
      expect(callArgs.container_files["devcontainer.json"]).toBe(
        '{"name": "Test Container"}'
      );
      expect(callArgs.container_files["Dockerfile"]).toBe("FROM node:18");
    });

    it("saves new container files when swarm has none", async () => {
      // Create a new workspace for this test to avoid constraints
      const uniqueWorkspace = await db.workspace.create({
        data: {
          name: "Test Workspace No Files",
          slug: generateUniqueSlug("no-files-ws"),
          ownerId: userId,
        },
      });

      // Create swarm without container files
      const swarmWithoutFiles = await db.swarm.create({
        data: {
          workspaceId: uniqueWorkspace.id,
          name: "swarm-no-files",
          status: "ACTIVE",
          swarmId: generateUniqueId("swarm-no-files"),
          swarmUrl: "https://test.sphinx.chat/api",
          poolApiKey: JSON.stringify(
            enc.encryptField("poolApiKey", PLAINTEXT_POOL_API_KEY)
          ),
          services: [],
          containerFiles: {},
          environmentVariables: "[]",
        },
      });

      const newContainerFiles = {
        "devcontainer.json": '{"name": "New Container"}',
        "Dockerfile": "FROM node:20",
      };

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: swarmWithoutFiles.id,
          workspaceId: uniqueWorkspace.id,
          container_files: newContainerFiles,
        }
      );

      await POST(req);

      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmId: swarmWithoutFiles.id,
          workspaceId: uniqueWorkspace.id,
          containerFiles: newContainerFiles,
        })
      );
    });

    it("retrieves and decrypts poolApiKey from swarm", async () => {
      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      await POST(req);

      expect(mockGetSwarmPoolApiKeyFor).toHaveBeenCalledWith(swarmId);
    });

    it("generates poolApiKey if none exists", async () => {
      // Create a new workspace for this test to avoid constraints
      const uniqueWorkspace = await db.workspace.create({
        data: {
          name: "Test Workspace No Key",
          slug: generateUniqueSlug("no-key-ws"),
          ownerId: userId,
        },
      });

      // Create swarm without poolApiKey
      const swarmWithoutKey = await db.swarm.create({
        data: {
          workspaceId: uniqueWorkspace.id,
          name: "swarm-no-key",
          status: "ACTIVE",
          swarmId: generateUniqueId("swarm-no-key"),
          swarmUrl: "https://test.sphinx.chat/api",
          services: [],
          containerFiles: {},
          environmentVariables: "[]",
        },
      });

      mockGetSwarmPoolApiKeyFor.mockResolvedValueOnce("");

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: swarmWithoutKey.id,
          workspaceId: uniqueWorkspace.id,
          container_files: {},
        }
      );

      await POST(req);

      expect(mockUpdateSwarmPoolApiKeyFor).toHaveBeenCalledWith(
        swarmWithoutKey.id
      );
      expect(mockGetSwarmPoolApiKeyFor).toHaveBeenCalledTimes(2);
    });

    it("decrypts environment variables before sending to Pool Manager", async () => {
      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      await POST(req);

      const callArgs = mockCreatePool.mock.calls[0][0];
      expect(callArgs.env_vars[0].value).toBe("test_value"); // Decrypted value
    });

    it("uses GitHub PAT from getGithubUsernameAndPAT", async () => {
      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      await POST(req);

      expect(mockGetGithubUsernameAndPAT).toHaveBeenCalledWith(
        userId,
        workspaceSlug
      );

      const callArgs = mockCreatePool.mock.calls[0][0];
      expect(callArgs.github_pat).toBe("ghp_test_token_123");
      expect(callArgs.github_username).toBe("testuser");
    });

    it("updates poolState to COMPLETE on successful pool creation", async () => {
      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      await POST(req);

      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmId,
          workspaceId,
          poolName: swarmId,
          poolState: "COMPLETE",
        })
      );
    });
  });

  describe("Retry Logic", () => {
    it("retries pool creation up to 3 times with 1000ms delay", async () => {
      mockCreatePool
        .mockRejectedValueOnce(new Error("Network error 1"))
        .mockRejectedValueOnce(new Error("Network error 2"))
        .mockResolvedValueOnce({
          id: "pool-123",
          name: "test-pool",
          description: "Test pool",
          owner_id: "owner-123",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: "active" as const,
        });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      const startTime = Date.now();
      const res = await POST(req);
      const endTime = Date.now();

      expect(res?.status).toBe(201);
      expect(mockCreatePool).toHaveBeenCalledTimes(3);

      // Verify retry delay (should be ~2000ms for 2 retries with 1000ms delay each)
      // Allow some tolerance for execution time
      expect(endTime - startTime).toBeGreaterThanOrEqual(2000);
      expect(endTime - startTime).toBeLessThan(3000);
    });

    it("throws error after 3 failed retry attempts", async () => {
      const errorMessage = "Persistent network error";
      mockCreatePool.mockRejectedValue(new Error(errorMessage));

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      const res = await POST(req);

      expect(res?.status).toBe(500);
      expect(mockCreatePool).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });
  });

  describe("Error Handling", () => {
    it("handles ApiError with status, message, service, and details preservation", async () => {
      const apiError: ApiError = {
        message: "Pool creation failed",
        status: 503,
        service: "poolManager",
        details: { reason: "Service unavailable" },
      };

      mockCreatePool.mockRejectedValue(apiError);

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      const res = await POST(req);

      expect(res?.status).toBe(503);
      const data = await res?.json();
      expect(data.error).toBe("Pool creation failed");
      expect(data.service).toBe("poolManager");
      expect(data.details).toEqual({ reason: "Service unavailable" });
    });

    it("updates poolState to FAILED on error", async () => {
      mockCreatePool.mockRejectedValue(new Error("Pool creation failed"));

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      await POST(req);

      expect(mockSaveOrUpdateSwarm).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId,
          poolState: "FAILED",
        })
      );
    });

    it("returns generic 500 error for non-ApiError exceptions", async () => {
      mockCreatePool.mockRejectedValue(new Error("Unexpected error"));

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      const res = await POST(req);

      expect(res?.status).toBe(500);
      const data = await res?.json();
      expect(data.error).toBe("Failed to create pool");
    });
  });

  describe("Edge Cases", () => {
    it("handles swarm with string-formatted environmentVariables", async () => {
      // Create swarm with string format env vars
      const swarmWithStringEnv = await db.swarm.create({
        data: {
          workspaceId,
          name: "swarm-string-env",
          status: "ACTIVE",
          swarmId: generateUniqueId("swarm-string-env"),
          swarmUrl: "https://test.sphinx.chat/api",
          poolApiKey: JSON.stringify(
            enc.encryptField("poolApiKey", PLAINTEXT_POOL_API_KEY)
          ),
          services: [],
          containerFiles: {},
          environmentVariables: JSON.stringify([
            {
              name: "STRING_ENV",
              value: enc.encryptField("environmentVariables", "string_value"),
            },
          ]),
        },
      });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: swarmWithStringEnv.id,
          workspaceId,
          container_files: {},
        }
      );

      const res = await POST(req);
      expect(res?.status).toBe(201);

      const callArgs = mockCreatePool.mock.calls[0][0];
      expect(callArgs.env_vars).toHaveLength(1);
      expect(callArgs.env_vars[0].name).toBe("STRING_ENV");
      expect(callArgs.env_vars[0].value).toBe("string_value");
    });

    it("uses default env vars when environmentVariables is not parseable", async () => {
      // Create swarm with invalid env vars
      const swarmWithInvalidEnv = await db.swarm.create({
        data: {
          workspaceId,
          name: "swarm-invalid-env",
          status: "ACTIVE",
          swarmId: generateUniqueId("swarm-invalid-env"),
          swarmUrl: "https://test.sphinx.chat/api",
          poolApiKey: JSON.stringify(
            enc.encryptField("poolApiKey", PLAINTEXT_POOL_API_KEY)
          ),
          services: [],
          containerFiles: {},
          environmentVariables: "invalid-json",
        },
      });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: swarmWithInvalidEnv.id,
          workspaceId,
          container_files: {},
        }
      );

      const res = await POST(req);
      expect(res?.status).toBe(201);

      const callArgs = mockCreatePool.mock.calls[0][0];
      // Should fall back to default env vars
      expect(callArgs.env_vars).toHaveLength(1);
      expect(callArgs.env_vars[0].name).toBe("MY_ENV");
      expect(callArgs.env_vars[0].value).toBe("MY_VALUE");
    });

    it("handles workspace member access (not just owner)", async () => {
      // Create member user
      const memberUser = await db.user.create({
        data: {
          email: `member-${generateUniqueId()}@example.com`,
          name: "Member User",
        },
      });

      // Add as workspace member
      await db.workspaceMember.create({
        data: {
          workspaceId,
          userId: memberUser.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(memberUser)
      );

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId,
          workspaceId,
          container_files: {},
        }
      );

      const res = await POST(req);
      expect(res?.status).toBe(201);
    });
  });
});