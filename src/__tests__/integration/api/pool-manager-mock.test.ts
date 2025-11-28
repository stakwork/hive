import { describe, test, beforeEach, expect } from "vitest";
import { POST as CreatePool } from "@/app/api/mock/pool-manager/pools/route";
import {
  GET as GetPool,
  PUT as UpdatePool,
  DELETE as DeletePool,
} from "@/app/api/mock/pool-manager/pools/[name]/route";
import { poolManagerState } from "@/app/api/mock/pool-manager/state";
import { NextRequest } from "next/server";

describe("Pool Manager Mock Endpoints - Integration Tests", () => {
  beforeEach(() => {
    // Clear state before each test
    poolManagerState.clear();
  });

  describe("POST /api/mock/pool-manager/pools", () => {
    test("should create a new pool successfully", async () => {
      const requestBody = {
        pool_name: "test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_secret123",
        github_username: "testuser",
        env_vars: [
          { name: "NODE_ENV", value: "development" },
          { name: "API_KEY", value: "secret123" },
        ],
        container_files: {
          devcontainer: "base64content",
          dockerfile: "base64content",
        },
      };

      const request = new NextRequest("http://localhost:3000/api/mock/pool-manager/pools", {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: {
          "Content-Type": "application/json",
        },
      });

      const response = await CreatePool(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toMatchObject({
        name: "test-pool",
        status: "active",
      });
      expect(data.id).toBeDefined();
      expect(data.created_at).toBeDefined();
    });

    test("should reject duplicate pool names", async () => {
      const requestBody = {
        pool_name: "duplicate-pool",
        minimum_vms: 1,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_secret",
        github_username: "testuser",
        env_vars: [],
        container_files: {},
      };

      // Create first pool
      const request1 = new NextRequest("http://localhost:3000/api/mock/pool-manager/pools", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      await CreatePool(request1);

      // Try to create duplicate
      const request2 = new NextRequest("http://localhost:3000/api/mock/pool-manager/pools", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      const response = await CreatePool(request2);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.error).toContain("already exists");
    });

    test("should validate required fields", async () => {
      const incompleteBody = {
        pool_name: "test-pool",
        // Missing required fields
      };

      const request = new NextRequest("http://localhost:3000/api/mock/pool-manager/pools", {
        method: "POST",
        body: JSON.stringify(incompleteBody),
      });

      const response = await CreatePool(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Missing required field");
    });

    test("should mask sensitive environment variables", async () => {
      const requestBody = {
        pool_name: "security-test-pool",
        minimum_vms: 1,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_supersecret",
        github_username: "testuser",
        env_vars: [
          { name: "DATABASE_PASSWORD", value: "supersecret123" },
          { name: "PUBLIC_VAR", value: "visible" },
        ],
        container_files: {},
      };

      const request = new NextRequest("http://localhost:3000/api/mock/pool-manager/pools", {
        method: "POST",
        body: JSON.stringify(requestBody),
      });

      await CreatePool(request);

      // Verify via GET that sensitive data is masked
      const pool = poolManagerState.getPool("security-test-pool");
      expect(pool?.config.github_pat).toBe("***MASKED***");
      const passwordVar = pool?.config.env_vars.find((v) => v.name === "DATABASE_PASSWORD");
      expect(passwordVar?.value).toBe("***MASKED***");
      expect(passwordVar?.masked).toBe(true);
    });
  });

  describe("GET /api/mock/pool-manager/pools/[name]", () => {
    test("should return pool status successfully", async () => {
      // Create a pool first
      poolManagerState.createPool({
        pool_name: "status-test-pool",
        minimum_vms: 3,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_secret",
        github_username: "testuser",
        env_vars: [],
        container_files: {},
      });

      const request = new NextRequest(
        "http://localhost:3000/api/mock/pool-manager/pools/status-test-pool"
      );

      const response = await GetPool(request, { params: { name: "status-test-pool" } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        name: "status-test-pool",
        status: {
          running_vms: 3,
          pending_vms: 0,
          failed_vms: 0,
          used_vms: 0,
          unused_vms: 3,
        },
      });
      expect(data.status.last_check).toBeDefined();
    });

    test("should return 404 for non-existent pool", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/pool-manager/pools/nonexistent"
      );

      const response = await GetPool(request, { params: { name: "nonexistent" } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("not found");
    });

    test("should include environment variables in config", async () => {
      poolManagerState.createPool({
        pool_name: "config-test-pool",
        minimum_vms: 1,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_secret",
        github_username: "testuser",
        env_vars: [
          { name: "VAR1", value: "value1" },
          { name: "VAR2", value: "value2" },
        ],
        container_files: {},
      });

      const request = new NextRequest(
        "http://localhost:3000/api/mock/pool-manager/pools/config-test-pool"
      );

      const response = await GetPool(request, { params: { name: "config-test-pool" } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.config.env_vars).toHaveLength(2);
      expect(data.config.env_vars).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "VAR1" }),
          expect.objectContaining({ name: "VAR2" }),
        ])
      );
    });
  });

  describe("PUT /api/mock/pool-manager/pools/[name]", () => {
    test("should update pool environment variables successfully", async () => {
      // Create a pool first
      poolManagerState.createPool({
        pool_name: "update-test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_secret",
        github_username: "testuser",
        env_vars: [{ name: "OLD_VAR", value: "old_value" }],
        container_files: {},
      });

      const updateBody = {
        env_vars: [
          { name: "NEW_VAR", value: "new_value" },
          { name: "ANOTHER_VAR", value: "another_value" },
        ],
        poolCpu: "4",
        poolMemory: "8Gi",
      };

      const request = new NextRequest(
        "http://localhost:3000/api/mock/pool-manager/pools/update-test-pool",
        {
          method: "PUT",
          body: JSON.stringify(updateBody),
        }
      );

      const response = await UpdatePool(request, { params: { name: "update-test-pool" } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify the update
      const pool = poolManagerState.getPool("update-test-pool");
      expect(pool?.config.env_vars).toHaveLength(2);
      expect(pool?.config.poolCpu).toBe("4");
      expect(pool?.config.poolMemory).toBe("8Gi");
    });

    test("should return 404 for non-existent pool", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/pool-manager/pools/nonexistent",
        {
          method: "PUT",
          body: JSON.stringify({ env_vars: [] }),
        }
      );

      const response = await UpdatePool(request, { params: { name: "nonexistent" } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("not found");
    });

    test("should update github credentials", async () => {
      poolManagerState.createPool({
        pool_name: "creds-test-pool",
        minimum_vms: 1,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "old_pat",
        github_username: "olduser",
        env_vars: [],
        container_files: {},
      });

      const updateBody = {
        env_vars: [],
        github_pat: "new_pat",
        github_username: "newuser",
      };

      const request = new NextRequest(
        "http://localhost:3000/api/mock/pool-manager/pools/creds-test-pool",
        {
          method: "PUT",
          body: JSON.stringify(updateBody),
        }
      );

      const response = await UpdatePool(request, { params: { name: "creds-test-pool" } });
      expect(response.status).toBe(200);

      const pool = poolManagerState.getPool("creds-test-pool");
      expect(pool?.config.github_pat).toBe("***MASKED***"); // Always masked
      expect(pool?.config.github_username).toBe("newuser");
    });
  });

  describe("DELETE /api/mock/pool-manager/pools/[name]", () => {
    test("should delete a pool successfully", async () => {
      // Create a pool first
      poolManagerState.createPool({
        pool_name: "delete-test-pool",
        minimum_vms: 1,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_secret",
        github_username: "testuser",
        env_vars: [],
        container_files: {},
      });

      const request = new NextRequest(
        "http://localhost:3000/api/mock/pool-manager/pools/delete-test-pool"
      );

      const response = await DeletePool(request, { params: { name: "delete-test-pool" } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.status).toBe("deleted");

      // Verify pool is deleted
      const pool = poolManagerState.getPool("delete-test-pool");
      expect(pool).toBeUndefined();
    });

    test("should return 404 for non-existent pool", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/pool-manager/pools/nonexistent"
      );

      const response = await DeletePool(request, { params: { name: "nonexistent" } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("not found");
    });

    test("should return pool data in response", async () => {
      poolManagerState.createPool({
        pool_name: "response-test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_secret",
        github_username: "testuser",
        env_vars: [],
        container_files: {},
      });

      const request = new NextRequest(
        "http://localhost:3000/api/mock/pool-manager/pools/response-test-pool"
      );

      const response = await DeletePool(request, { params: { name: "response-test-pool" } });
      const data = await response.json();

      expect(data).toMatchObject({
        name: "response-test-pool",
        status: "deleted",
      });
      expect(data.id).toBeDefined();
      expect(data.updated_at).toBeDefined();
    });
  });

  describe("State Management", () => {
    test("should maintain pool state across operations", async () => {
      // Create pool
      poolManagerState.createPool({
        pool_name: "state-test-pool",
        minimum_vms: 2,
        repo_name: "test-repo",
        branch_name: "main",
        github_pat: "ghp_secret",
        github_username: "testuser",
        env_vars: [{ name: "VAR1", value: "value1" }],
        container_files: {},
      });

      // Get pool
      let pool = poolManagerState.getPool("state-test-pool");
      expect(pool).toBeDefined();
      const originalCreatedAt = pool!.created_at;
      const originalUpdatedAt = pool!.updated_at;

      // Small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      // Update pool
      poolManagerState.updatePoolEnvVars("state-test-pool", [
        { name: "VAR2", value: "value2" },
      ]);

      // Verify state persisted
      pool = poolManagerState.getPool("state-test-pool");
      expect(pool?.created_at).toBe(originalCreatedAt);
      expect(new Date(pool!.updated_at).getTime()).toBeGreaterThan(new Date(originalUpdatedAt).getTime());
      expect(pool?.config.env_vars).toHaveLength(1);
    });

    test("should list all active pools", async () => {
      poolManagerState.createPool({
        pool_name: "pool-1",
        minimum_vms: 1,
        repo_name: "repo1",
        branch_name: "main",
        github_pat: "pat",
        github_username: "user",
        env_vars: [],
        container_files: {},
      });

      poolManagerState.createPool({
        pool_name: "pool-2",
        minimum_vms: 1,
        repo_name: "repo2",
        branch_name: "main",
        github_pat: "pat",
        github_username: "user",
        env_vars: [],
        container_files: {},
      });

      const pools = poolManagerState.listPools();
      expect(pools).toHaveLength(2);
      expect(pools.map((p) => p.name)).toContain("pool-1");
      expect(pools.map((p) => p.name)).toContain("pool-2");
    });

    test("should clear all pools", async () => {
      poolManagerState.createPool({
        pool_name: "clear-test-1",
        minimum_vms: 1,
        repo_name: "repo",
        branch_name: "main",
        github_pat: "pat",
        github_username: "user",
        env_vars: [],
        container_files: {},
      });

      poolManagerState.createPool({
        pool_name: "clear-test-2",
        minimum_vms: 1,
        repo_name: "repo",
        branch_name: "main",
        github_pat: "pat",
        github_username: "user",
        env_vars: [],
        container_files: {},
      });

      expect(poolManagerState.listPools()).toHaveLength(2);

      poolManagerState.clear();

      expect(poolManagerState.listPools()).toHaveLength(0);
    });
  });
});
