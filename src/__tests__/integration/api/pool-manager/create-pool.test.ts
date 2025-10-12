import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/pool-manager/create-pool/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectForbidden,
  expectError,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import { db } from "@/lib/db";
import type { CreatePoolRequest } from "@/types/pool-manager";

// Mock the service factory to control poolManagerService behavior
vi.mock("@/lib/service-factory", () => ({
  poolManagerService: vi.fn(() => ({
    createPool: vi.fn(),
  })),
}));

import { poolManagerService } from "@/lib/service-factory";

describe("Pool Manager Create Pool API Integration Tests", () => {
  let mockCreatePool: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePool = vi.fn();
    (poolManagerService as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      createPool: mockCreatePool,
    });
  });

  async function createTestScenarioWithSwarm() {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Test Owner" },
    });

    const swarm = await db.swarm.create({
      data: {
        name: "test-swarm",
        workspaceId: scenario.workspace.id,
        poolApiKey: JSON.stringify({
          data: "encrypted-api-key",
          iv: "test-iv",
          tag: "test-tag",
          version: "v1",
          encryptedAt: new Date().toISOString(),
        }),
      },
    });

    return {
      ...scenario,
      swarm,
    };
  }

  describe("POST /api/pool-manager/create-pool", () => {
    test("should create pool successfully with valid request", async () => {
      const { owner, workspace, swarm } = await createTestScenarioWithSwarm();

      const mockPoolResponse = {
        pool: {
          id: "pool-123",
          name: "test-pool",
          status: "active",
          owner_id: "owner-123",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };

      mockCreatePool.mockResolvedValue(mockPoolResponse);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const poolRequest: CreatePoolRequest = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_test123",
        github_username: "testuser",
        env_vars: { NODE_ENV: "test" },
        container_files: [],
      };

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/create-pool?workspaceId=${workspace.id}&swarmId=${swarm.id}`,
        poolRequest
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.pool).toBeDefined();
      expect(data.pool.name).toBe("test-pool");
      expect(data.pool.status).toBe("active");

      // Verify createPool was called with correct parameters
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          pool_name: "test-pool",
          minimum_vms: 2,
          repo_name: "test-repo",
        })
      );
    });

    test("should return 401 when user not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const poolRequest: CreatePoolRequest = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_test123",
        github_username: "testuser",
        env_vars: {},
        container_files: [],
      };

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool?workspaceId=ws-123&swarmId=sw-123",
        poolRequest
      );

      const response = await POST(request);

      await expectUnauthorized(response);
      expect(mockCreatePool).not.toHaveBeenCalled();
    });

    test("should return 400 for missing workspaceId", async () => {
      const { owner } = await createTestScenarioWithSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const poolRequest: CreatePoolRequest = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_test123",
        github_username: "testuser",
        env_vars: {},
        container_files: [],
      };

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/create-pool?swarmId=sw-123",
        poolRequest
      );

      const response = await POST(request);

      await expectError(response, "workspaceId is required", 400);
      expect(mockCreatePool).not.toHaveBeenCalled();
    });

    test("should return 400 for missing swarmId", async () => {
      const { owner, workspace } = await createTestScenarioWithSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const poolRequest: CreatePoolRequest = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_test123",
        github_username: "testuser",
        env_vars: {},
        container_files: [],
      };

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/create-pool?workspaceId=${workspace.id}`,
        poolRequest
      );

      const response = await POST(request);

      await expectError(response, "swarmId is required", 400);
      expect(mockCreatePool).not.toHaveBeenCalled();
    });

    test("should return 403 when user lacks workspace access", async () => {
      const { workspace, swarm } = await createTestScenarioWithSwarm();
      
      // Create a different user without workspace access
      const outsideUser = await createTestUser({ name: "Outside User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(outsideUser));

      const poolRequest: CreatePoolRequest = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_test123",
        github_username: "testuser",
        env_vars: {},
        container_files: [],
      };

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/create-pool?workspaceId=${workspace.id}&swarmId=${swarm.id}`,
        poolRequest
      );

      const response = await POST(request);

      await expectForbidden(response, "You do not have access to this workspace");
      expect(mockCreatePool).not.toHaveBeenCalled();
    });

    test("should return 404 when swarm not found", async () => {
      const { owner, workspace } = await createTestScenarioWithSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const poolRequest: CreatePoolRequest = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_test123",
        github_username: "testuser",
        env_vars: {},
        container_files: [],
      };

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/create-pool?workspaceId=${workspace.id}&swarmId=nonexistent-swarm`,
        poolRequest
      );

      const response = await POST(request);

      await expectError(response, "Swarm not found", 404);
      expect(mockCreatePool).not.toHaveBeenCalled();
    });

    test("should return 400 for invalid pool request body", async () => {
      const { owner, workspace, swarm } = await createTestScenarioWithSwarm();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Missing required fields
      const invalidRequest = {
        pool_name: "test-pool",
        // Missing minimum_vms, repo_name, etc.
      };

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/create-pool?workspaceId=${workspace.id}&swarmId=${swarm.id}`,
        invalidRequest
      );

      const response = await POST(request);

      await expectError(response, "required", 400);
      expect(mockCreatePool).not.toHaveBeenCalled();
    });

    test("should handle external service error (500)", async () => {
      const { owner, workspace, swarm } = await createTestScenarioWithSwarm();

      mockCreatePool.mockRejectedValue(
        Object.assign(new Error("External service error"), {
          statusCode: 500,
          message: "Internal server error from Pool Manager",
        })
      );

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const poolRequest: CreatePoolRequest = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_test123",
        github_username: "testuser",
        env_vars: {},
        container_files: [],
      };

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/create-pool?workspaceId=${workspace.id}&swarmId=${swarm.id}`,
        poolRequest
      );

      const response = await POST(request);

      await expectError(response, "Internal server error from Pool Manager", 500);
      expect(mockCreatePool).toHaveBeenCalled();
    });

    test("should handle external service error (404 - resource not found)", async () => {
      const { owner, workspace, swarm } = await createTestScenarioWithSwarm();

      mockCreatePool.mockRejectedValue(
        Object.assign(new Error("Resource not found"), {
          statusCode: 404,
          message: "GitHub repository not found",
        })
      );

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const poolRequest: CreatePoolRequest = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "nonexistent-repo",
        branch_name: "main",
        github_pat: "ghp_test123",
        github_username: "testuser",
        env_vars: {},
        container_files: [],
      };

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/create-pool?workspaceId=${workspace.id}&swarmId=${swarm.id}`,
        poolRequest
      );

      const response = await POST(request);

      await expectError(response, "GitHub repository not found", 404);
      expect(mockCreatePool).toHaveBeenCalled();
    });

    test("should handle external service error (401 - unauthorized)", async () => {
      const { owner, workspace, swarm } = await createTestScenarioWithSwarm();

      mockCreatePool.mockRejectedValue(
        Object.assign(new Error("Unauthorized"), {
          statusCode: 401,
          message: "Invalid GitHub PAT",
        })
      );

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const poolRequest: CreatePoolRequest = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "invalid-pat",
        github_username: "testuser",
        env_vars: {},
        container_files: [],
      };

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/create-pool?workspaceId=${workspace.id}&swarmId=${swarm.id}`,
        poolRequest
      );

      const response = await POST(request);

      await expectError(response, "Invalid GitHub PAT", 401);
      expect(mockCreatePool).toHaveBeenCalled();
    });

    test("should handle external service timeout", async () => {
      const { owner, workspace, swarm } = await createTestScenarioWithSwarm();

      mockCreatePool.mockRejectedValue(
        Object.assign(new Error("Request timeout"), {
          statusCode: 408,
          message: "Pool creation timed out",
        })
      );

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const poolRequest: CreatePoolRequest = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_test123",
        github_username: "testuser",
        env_vars: {},
        container_files: [],
      };

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/create-pool?workspaceId=${workspace.id}&swarmId=${swarm.id}`,
        poolRequest
      );

      const response = await POST(request);

      await expectError(response, "Pool creation timed out", 408);
      expect(mockCreatePool).toHaveBeenCalled();
    });

    test("should create pool with optional env_vars and container_files", async () => {
      const { owner, workspace, swarm } = await createTestScenarioWithSwarm();

      const mockPoolResponse = {
        pool: {
          id: "pool-456",
          name: "advanced-pool",
          status: "active",
          owner_id: "owner-123",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };

      mockCreatePool.mockResolvedValue(mockPoolResponse);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const poolRequest: CreatePoolRequest = {
        pool_name: "advanced-pool",
        minimum_vms: 3,
        repo_name: "test-repo",
        branch_name: "develop",
        github_pat: "ghp_test456",
        github_username: "advanceduser",
        env_vars: {
          NODE_ENV: "production",
          API_KEY: "secret-key",
          DATABASE_URL: "postgresql://localhost:5432/db",
        },
        container_files: [
          { path: "/app/config.json", content: '{"key": "value"}' },
          { path: "/app/.env", content: "SECRET=xyz" },
        ],
      };

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/create-pool?workspaceId=${workspace.id}&swarmId=${swarm.id}`,
        poolRequest
      );

      const response = await POST(request);

      const data = await expectSuccess(response, 201);
      expect(data.pool).toBeDefined();
      expect(data.pool.name).toBe("advanced-pool");

      // Verify createPool was called with env_vars and container_files
      expect(mockCreatePool).toHaveBeenCalledWith(
        expect.objectContaining({
          pool_name: "advanced-pool",
          env_vars: expect.objectContaining({
            NODE_ENV: "production",
            API_KEY: "secret-key",
          }),
          container_files: expect.arrayContaining([
            expect.objectContaining({ path: "/app/config.json" }),
          ]),
        })
      );
    });

    test("should handle pool name conflict (409)", async () => {
      const { owner, workspace, swarm } = await createTestScenarioWithSwarm();

      mockCreatePool.mockRejectedValue(
        Object.assign(new Error("Conflict"), {
          statusCode: 409,
          message: "Pool with name 'test-pool' already exists",
        })
      );

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const poolRequest: CreatePoolRequest = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_test123",
        github_username: "testuser",
        env_vars: {},
        container_files: [],
      };

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/create-pool?workspaceId=${workspace.id}&swarmId=${swarm.id}`,
        poolRequest
      );

      const response = await POST(request);

      await expectError(response, "already exists", 409);
      expect(mockCreatePool).toHaveBeenCalled();
    });
  });
});