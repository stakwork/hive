import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/pool-manager/create-pool/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  generateUniqueId,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";

// Mock PoolManagerService via service factory
const mockCreatePool = vi.fn(async () => ({
  id: "pool-123",
  name: "test-pool",
  status: "active",
}));

vi.mock("@/lib/service-factory", () => ({
  poolManagerService: () => ({
    createPool: mockCreatePool,
    deletePool: vi.fn(),
    getPoolStatus: vi.fn(),
    updatePoolData: vi.fn(),
  }),
  ServiceFactory: {
    clearInstances: vi.fn(),
  },
}));

// Mock EncryptionService - Define mock functions inline to avoid temporal dead zone
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: vi.fn((field, value) => ({
        data: Buffer.from(value).toString("base64"),
        iv: "mock-iv",
        tag: "mock-tag",
        keyId: "test-key",
        version: "v1",
        encryptedAt: new Date().toISOString(),
      })),
      decryptField: vi.fn((field, encryptedData) => {
        if (typeof encryptedData === "string") {
          try {
            const parsed = JSON.parse(encryptedData);
            if (parsed.data) {
              return Buffer.from(parsed.data, "base64").toString("utf-8");
            }
          } catch {
            return encryptedData;
          }
        }
        if (encryptedData?.data) {
          return Buffer.from(encryptedData.data, "base64").toString("utf-8");
        }
        return "decrypted-value";
      }),
    })),
  },
  decryptEnvVars: vi.fn((vars) =>
    vars.map((v) => ({
      name: v.name,
      value: typeof v.value === "string" ? v.value : "decrypted-value",
    }))
  ),
}));

// Extract mock functions for test access
const mockEncryptField = vi.fn((field, value) => ({
  data: Buffer.from(value).toString("base64"),
  iv: "mock-iv",
  tag: "mock-tag",
  keyId: "test-key",
  version: "v1",
  encryptedAt: new Date().toISOString(),
}));

const mockDecryptField = vi.fn((field, encryptedData) => {
  if (typeof encryptedData === "string") {
    try {
      const parsed = JSON.parse(encryptedData);
      if (parsed.data) {
        return Buffer.from(parsed.data, "base64").toString("utf-8");
      }
    } catch {
      return encryptedData;
    }
  }
  if (encryptedData?.data) {
    return Buffer.from(encryptedData.data, "base64").toString("utf-8");
  }
  return "decrypted-value";
});

describe("POST /api/pool-manager/create-pool", () => {
  const enc = EncryptionService.getInstance();
  let testData: {
    owner: any;
    workspace: any;
    swarm: any;
  };

  // Get mocked encryption service instance for assertions
  const mockedEncryptionService = enc as any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test scenario with workspace and swarm
    testData = await createTestWorkspaceScenario({
      withSwarm: true,
      swarm: {
        status: "ACTIVE",
        repositoryUrl: "https://github.com/test/repo",
      },
    });

    // Mock poolApiKey in swarm and add mock user
    await db.swarm.update({
      where: { id: testData.swarm.id },
      data: {
        poolApiKey: JSON.stringify(
          enc.encryptField("poolApiKey", "test-pool-api-key")
        ),
        containerFiles: {}, // Initially empty to test save logic
        environmentVariables: [
          {
            name: "TEST_ENV",
            value: enc.encryptField("environmentVariables", "test-value"),
          },
        ],
      },
    });

    // Update user email to be mock user for GitHub auth 
    await db.user.update({
      where: { id: testData.owner.id },
      data: {
        email: `${testData.owner.id}@mock.dev`,
      },
    });

    // Create repository for the workspace
    await db.repository.create({
      data: {
        workspaceId: testData.workspace.id,
        repositoryUrl: "https://github.com/test/repo",
        name: "test-repo",
        branch: "main",
      },
    });

    // Mock authenticated session
    getMockedSession().mockResolvedValue(
      createAuthenticatedSession(testData.owner)
    );
  });

  afterEach(async () => {
    // Cleanup created resources
    await db.repository.deleteMany({
      where: { workspaceId: testData.workspace.id },
    });
  });

  describe("Authentication & Authorization", () => {
    it("returns 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(null);

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 401 when user session is invalid (no email)", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: testData.owner.id, email: null },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 403 when user doesn't have workspace access", async () => {
      // Create a different user not associated with the workspace
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
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(json.error).toBe("Access denied");

      // Cleanup
      await db.user.delete({ where: { id: otherUser.id } });
    });

    it("returns 404 when swarm is not found", async () => {
      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: "non-existent-swarm-id",
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toBe("Swarm not found");
    });
  });

  describe("Input Validation", () => {
    it("returns 404 when swarmId is missing and no matching workspace", async () => {
      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          workspaceId: "non-existent-workspace",
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toBe("Swarm not found");
    });

    it("validates container_files is provided", async () => {
      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          // Missing container_files
        }
      );

      const res = await POST(req);
      // The endpoint should handle missing container_files
      // Based on code, it will use existing containerFiles or fail
      expect([400, 404, 500]).toContain(res.status);
    });
  });

  describe("Business Logic - Container Files", () => {
    it("uses existing container files if already saved", async () => {
      const existingContainerFiles = {
        "devcontainer.json": "existing-base64-content",
        Dockerfile: "existing-dockerfile",
        "docker-compose.yml": "existing-compose",
      };

      await db.swarm.update({
        where: { id: testData.swarm.id },
        data: {
          containerFiles: existingContainerFiles,
        },
      });

      mockCreatePool.mockResolvedValue({
        id: "pool-123",
        name: testData.swarm.id,
        status: "active",
      });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "new-base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(201);

      // Verify createPool was called with existing container files, not new ones
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          container_files: existingContainerFiles,
        })
      );
    });

    it("saves new container files if none exist", async () => {
      const newContainerFiles = {
        "devcontainer.json": "new-base64-content",
        Dockerfile: "new-dockerfile",
        "docker-compose.yml": "new-compose",
      };

      mockCreatePool.mockResolvedValue({
        id: "pool-123",
        name: testData.swarm.id,
        status: "active",
      });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: newContainerFiles,
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(201);

      // Verify container files were saved to database
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: testData.swarm.id },
      });
      expect(updatedSwarm?.containerFiles).toEqual(newContainerFiles);
    });
  });

  describe("Business Logic - Pool API Key", () => {
    it("retrieves poolApiKey from swarm", async () => {
      mockCreatePool.mockResolvedValue({
        id: "pool-123",
        name: testData.swarm.id,
        status: "active",
      });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(201);

      // Verify decryptField was called with poolApiKey
      expect(mockedEncryptionService.decryptField).toHaveBeenCalledWith(
        "poolApiKey",
        expect.anything()
      );
    });
  });

  describe("Business Logic - Environment Variables", () => {
    it("decrypts environment variables before sending to Pool Manager", async () => {
      mockCreatePool.mockResolvedValue({
        id: "pool-123",
        name: testData.swarm.id,
        status: "active",
      });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(201);

      // Verify createPool was called with decrypted env vars
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          env_vars: expect.arrayContaining([
            expect.objectContaining({
              name: expect.any(String),
              value: expect.any(String),
            }),
          ]),
        })
      );
    });
  });

  describe("Business Logic - Pool State Tracking", () => {
    it("updates poolState to COMPLETE on success", async () => {
      mockCreatePool.mockResolvedValue({
        id: "pool-123",
        name: testData.swarm.id,
        status: "active",
      });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(201);

      // Verify poolState was updated to COMPLETE
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: testData.swarm.id },
      });
      expect(updatedSwarm?.poolState).toBe("COMPLETE");
    });

    it("returns created pool with 201 status", async () => {
      const mockPool = {
        id: "pool-123",
        name: testData.swarm.id,
        status: "active",
      };

      mockCreatePool.mockResolvedValue(mockPool);

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.pool).toEqual(mockPool);
    });
  });

  describe("External Service Integration", () => {
    it("calls PoolManagerService.createPool with correct parameters", async () => {
      mockCreatePool.mockResolvedValue({
        id: "pool-123",
        name: testData.swarm.id,
        status: "active",
      });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(201);

      // Verify createPool was called once
      expect(mockCreatePool).toHaveBeenCalledOnce();

      // Verify parameters structure
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          pool_name: testData.swarm.id,
          minimum_vms: 2,
          repo_name: expect.any(String),
          branch_name: expect.any(String),
          github_pat: expect.any(String),
          github_username: expect.any(String),
          env_vars: expect.any(Array),
          container_files: expect.any(Object),
        })
      );
    });
  });

  describe("Retry Logic", () => {
    it("retries up to 3 times with 1000ms delay", async () => {
      // Mock to fail twice, then succeed on third attempt
      mockCreatePool
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          id: "pool-123",
          name: testData.swarm.id,
          status: "active",
        });

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const startTime = Date.now();
      const res = await POST(req);
      const endTime = Date.now();

      expect(res.status).toBe(201);

      // Verify createPool was called 3 times
      expect(mockCreatePool).toHaveBeenCalledTimes(3);

      // Verify delay occurred (should be at least 2000ms for 2 retries)
      expect(endTime - startTime).toBeGreaterThanOrEqual(2000);
    }, 15000); // Increase timeout for this test

    it("updates poolState to FAILED after all retries exhausted", async () => {
      // Mock to always fail
      mockCreatePool.mockRejectedValue(new Error("Persistent error"));

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(500);

      // Verify poolState was updated to FAILED
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: testData.swarm.id },
      });
      expect(updatedSwarm?.poolState).toBe("FAILED");

      // Verify all retry attempts were made (4 total: initial + 3 retries)
      expect(mockCreatePool).toHaveBeenCalledTimes(4);
    }, 15000); // Increase timeout for this test
  });

  describe("Error Handling", () => {
    it("preserves ApiError properties in response", async () => {
      const apiError = {
        message: "Pool Manager API error",
        status: 503,
        service: "poolManager",
        details: { reason: "Service unavailable" },
      };

      mockCreatePool.mockRejectedValue(apiError);

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(503);

      const json = await res.json();
      expect(json.error).toBe(apiError.message);
      expect(json.service).toBe(apiError.service);
      expect(json.details).toEqual(apiError.details);
    }, 15000);

    it("returns generic 500 error for non-ApiError exceptions", async () => {
      const genericError = new Error("Unexpected error");

      mockCreatePool.mockRejectedValue(genericError);

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(500);

      const json = await res.json();
      expect(json.error).toBe("Failed to create pool");
    }, 15000);

    it("updates poolState to FAILED on error", async () => {
      mockCreatePool.mockRejectedValue(new Error("Creation failed"));

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: {
            "devcontainer.json": "base64-content",
          },
        }
      );

      await POST(req);

      // Verify poolState was updated to FAILED
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: testData.swarm.id },
      });
      expect(updatedSwarm?.poolState).toBe("FAILED");
    }, 15000);
  });

  describe("Integration - Full Success Flow", () => {
    it("successfully creates pool with all components working together", async () => {
      const mockPool = {
        id: "pool-123",
        name: testData.swarm.id,
        status: "active",
      };

      mockCreatePool.mockResolvedValue(mockPool);

      const containerFiles = {
        "devcontainer.json": Buffer.from(
          JSON.stringify({ name: "Test Container" })
        ).toString("base64"),
        Dockerfile: Buffer.from("FROM node:18").toString("base64"),
        "docker-compose.yml": Buffer.from("version: '3.8'").toString(
          "base64"
        ),
      };

      const req = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool",
        {
          swarmId: testData.swarm.id,
          workspaceId: testData.workspace.id,
          container_files: containerFiles,
        }
      );

      const res = await POST(req);
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.pool).toEqual(mockPool);

      // Verify database state
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: testData.swarm.id },
      });
      expect(updatedSwarm?.poolState).toBe("COMPLETE");
      expect(updatedSwarm?.poolName).toBe(testData.swarm.swarmId);

      // Verify service was called correctly
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          pool_name: testData.swarm.id,
          minimum_vms: 2,
          container_files: containerFiles,
        })
      );
    });
  });
});