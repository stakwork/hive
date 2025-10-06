import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/pool-manager/create-pool/route";
import { db } from "@/lib/db";
import {
  createPostRequest,
  getMockedSession,
  createAuthenticatedSession,
  mockUnauthenticatedSession,
} from "@/__tests__/support/helpers";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import type { User } from "@prisma/client";

const mockCreatePool = vi.hoisted(() => vi.fn());
const mockEncryptField = vi.hoisted(() => vi.fn());
const mockDecryptField = vi.hoisted(() => vi.fn());
const mockGetSwarmPoolApiKeyFor = vi.hoisted(() => vi.fn());
const mockUpdateSwarmPoolApiKeyFor = vi.hoisted(() => vi.fn());
const mockSaveOrUpdateSwarm = vi.hoisted(() => vi.fn());
const mockGetGithubUsernameAndPAT = vi.hoisted(() => vi.fn());

vi.mock("@/services/pool-manager/PoolManagerService", () => ({
  PoolManagerService: vi.fn().mockImplementation(() => ({
    createPool: mockCreatePool,
  })),
}));

vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: mockGetSwarmPoolApiKeyFor,
  updateSwarmPoolApiKeyFor: mockUpdateSwarmPoolApiKeyFor,
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      encryptField: mockEncryptField,
      decryptField: mockDecryptField,
    })),
  },
  encryptionService: {
    encryptField: mockEncryptField,
    decryptField: mockDecryptField,
  },
  decryptEnvVars: vi.fn().mockImplementation((vars) =>
    vars.map((v: any) => ({
      name: v.name,
      value: typeof v.value === 'object' && 'data' in v.value
        ? v.value.data.replace('encrypted-', '')
        : v.value,
    }))
  ),
}));

vi.mock("@/services/swarm/db", () => ({
  saveOrUpdateSwarm: mockSaveOrUpdateSwarm,
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT,
}));

describe("POST /api/pool-manager/create-pool", () => {
  let testUser: User;
  let workspaceId: string;
  let swarmId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const scenario = await createTestWorkspaceScenario({
      withSwarm: true,
      swarm: {
        status: "ACTIVE",
        repositoryUrl: "https://github.com/test/repo",
        poolApiKey: "encrypted-pool-api-key",
        containerFiles: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
          Dockerfile: "FROM node:20",
          "docker-compose.yml": "version: '3'",
        },
      },
    });

    testUser = scenario.owner;
    workspaceId = scenario.workspace.id;
    swarmId = scenario.swarm!.id;

    await db.repository.create({
      data: {
        workspaceId,
        repositoryUrl: "https://github.com/test/repo",
        branch: "main",
        name: "test-repo",
      },
    });

    mockEncryptField.mockImplementation((field: string, value: string) => ({
      data: `encrypted-${value}`,
      iv: "test-iv",
      tag: "test-tag",
      keyId: "k-test",
      version: "1",
      encryptedAt: new Date().toISOString(),
    }));

    mockDecryptField.mockImplementation(
      (field: string, value: string | object) => {
        if (typeof value === "string") {
          return value.replace("encrypted-", "");
        }
        if (typeof value === "object" && "data" in value) {
          return (value as { data: string }).data.replace("encrypted-", "");
        }
        return value;
      }
    );

    mockCreatePool.mockResolvedValue({
      pool_name: swarmId,
      message: "Pool created successfully",
    });

    mockGetSwarmPoolApiKeyFor.mockResolvedValue("pool-api-key-value");
    mockSaveOrUpdateSwarm.mockResolvedValue({});
    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "test-token",
    });
  });

  describe("Authentication & Authorization", () => {
    it("returns 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when user session is invalid", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 401 when user email is missing", async () => {
      const sessionWithoutEmail = createAuthenticatedSession(testUser);
      sessionWithoutEmail.user.email = null;

      getMockedSession().mockResolvedValue(sessionWithoutEmail);

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("returns 403 when user is not workspace owner or member", async () => {
      const otherUser = await db.user.create({
        data: {
          email: "other@example.com",
          name: "Other User",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(otherUser));

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });
  });

  describe("Input Validation", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
    });

    it("returns 404 when swarm is not found", async () => {
      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId: "non-existent-swarm-id",
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found");
    });

    it("returns 404 when workspace is not found", async () => {
      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId: "non-existent-workspace-id",
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found");
    });

    it("returns 404 when swarm id is missing", async () => {
      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Swarm not found");
    });
  });

  describe("Business Logic & Success Cases", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
    });

    it("creates pool with correct parameters", async () => {
      const containerFiles = {
        "devcontainer.json": JSON.stringify({ name: "test-container" }),
        Dockerfile: "FROM node:20-alpine",
        "docker-compose.yml": "version: '3.8'",
      };

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: containerFiles,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.pool.pool_name).toBe(swarmId);
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          pool_name: swarmId,
          minimum_vms: 2,
          repo_name: "https://github.com/test/repo",
          branch_name: "main",
          container_files: containerFiles,
        })
      );
    });

    it("uses existing container files if already saved", async () => {
      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "new-container" }),
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          container_files: {
            "devcontainer.json": JSON.stringify({ name: "test" }),
            Dockerfile: "FROM node:20",
            "docker-compose.yml": "version: '3'",
          },
        })
      );
    });

    it("saves new container files if none exist", async () => {
      await db.swarm.update({
        where: { id: swarmId },
        data: { containerFiles: {} },
      });

      const newContainerFiles = {
        "devcontainer.json": JSON.stringify({ name: "brand-new" }),
        Dockerfile: "FROM python:3.11",
      };

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: newContainerFiles,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);

      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarmId },
      });

      expect(updatedSwarm?.containerFiles).toEqual(newContainerFiles);
    });

    it("retrieves and decrypts poolApiKey from swarm", async () => {
      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      await POST(request);

      expect(mockGetSwarmPoolApiKeyFor).toHaveBeenCalledWith(swarmId);
      expect(mockDecryptField).toHaveBeenCalledWith("poolApiKey", "pool-api-key-value");
    });

    it("generates poolApiKey if none exists", async () => {
      mockGetSwarmPoolApiKeyFor.mockResolvedValueOnce(null);
      mockGetSwarmPoolApiKeyFor.mockResolvedValueOnce("generated-key-value");
      
      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      await POST(request);

      expect(mockUpdateSwarmPoolApiKeyFor).toHaveBeenCalledWith(swarmId);
      expect(mockGetSwarmPoolApiKeyFor).toHaveBeenCalledTimes(2);
    });

    it("decrypts environment variables before sending to Pool Manager", async () => {
      await db.swarm.update({
        where: { id: swarmId },
        data: {
          environmentVariables: [
            {
              name: "TEST_VAR",
              value: {
                data: "encrypted-secret-value",
                iv: "test-iv",
                tag: "test-tag",
              },
            },
          ] as any,
        },
      });

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      await POST(request);

      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          env_vars: expect.arrayContaining([
            expect.objectContaining({
              name: "TEST_VAR",
              value: "secret-value",
            }),
          ]),
        })
      );
    });

    it("updates swarm with poolState COMPLETE on success", async () => {
      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      await POST(request);

      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarmId },
        select: { poolState: true, poolName: true },
      });

      expect(updatedSwarm?.poolState).toBe("COMPLETE");
      expect(updatedSwarm?.poolName).toBe(swarmId);
    });
  });

  describe("Retry Logic", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("retries up to 3 times with 1000ms delay on failure", async () => {
      mockCreatePool
        .mockRejectedValueOnce(new Error("Network error"))
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          pool_name: swarmId,
          message: "Pool created successfully",
        });

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      const responsePromise = POST(request);

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      const response = await responsePromise;
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.pool.pool_name).toBe(swarmId);
      expect(mockCreatePool).toHaveBeenCalledTimes(3);
    });

    it("throws error after 3 failed retry attempts", async () => {
      mockCreatePool.mockRejectedValue(new Error("Persistent network error"));

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      const responsePromise = POST(request);

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      const response = await responsePromise;
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create pool");
      expect(mockCreatePool).toHaveBeenCalledTimes(4);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
    });

    it("handles ApiError and preserves status, message, service, and details", async () => {
      const apiError = {
        message: "Pool Manager API error",
        status: 503,
        service: "poolManager",
        details: { reason: "Service unavailable" },
      };

      mockCreatePool.mockRejectedValue(apiError);

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.error).toBe("Pool Manager API error");
      expect(data.service).toBe("poolManager");
      expect(data.details).toEqual({ reason: "Service unavailable" });
    });

    it("returns generic 500 error for non-ApiError exceptions", async () => {
      mockCreatePool.mockRejectedValue(new Error("Unexpected error"));

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create pool");
    });

    it("updates swarm with poolState FAILED on error", async () => {
      mockCreatePool.mockRejectedValue(new Error("Pool creation failed"));

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      await POST(request);

      const updatedSwarm = await db.swarm.findUnique({
        where: { workspaceId },
        select: { poolState: true },
      });

      expect(updatedSwarm?.poolState).toBe("FAILED");
    });
  });

  describe("poolState Transitions", () => {
    beforeEach(() => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
    });

    it("transitions poolState from NOT_STARTED to COMPLETE on successful creation", async () => {
      await db.swarm.update({
        where: { id: swarmId },
        data: { poolState: "NOT_STARTED" },
      });

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      await POST(request);

      const updatedSwarm = await db.swarm.findUnique({
        where: { workspaceId },
        select: { poolState: true },
      });

      expect(updatedSwarm?.poolState).toBe("COMPLETE");
    });

    it("transitions poolState to FAILED on creation error", async () => {
      await db.swarm.update({
        where: { id: swarmId },
        data: { poolState: "NOT_STARTED" },
      });

      mockCreatePool.mockRejectedValue(new Error("Creation failed"));

      const request = createPostRequest("http://localhost:3000/api/pool-manager/create-pool", {
        swarmId,
        workspaceId,
        container_files: {
          "devcontainer.json": JSON.stringify({ name: "test" }),
        },
      });

      await POST(request);

      const updatedSwarm = await db.swarm.findUnique({
        where: { workspaceId },
        select: { poolState: true },
      });

      expect(updatedSwarm?.poolState).toBe("FAILED");
    });
  });
});