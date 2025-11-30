import { describe, it, expect, beforeEach } from "vitest";
import { mockPoolState } from "@/lib/mock/pool-manager-state";

describe("Pool Manager Mock State", () => {
  beforeEach(() => {
    mockPoolState.reset();
  });

  describe("Pool Management", () => {
    it("should create a pool with specified pods", () => {
      const pool = mockPoolState.createPool("test-pool", 3);

      expect(pool.name).toBe("test-pool");
      expect(pool.maxPods).toBe(3);
      expect(pool.pods).toHaveLength(3);
      expect(pool.pods[0].usage_status).toBe("available");
    });

    it("should list all pools", () => {
      mockPoolState.createPool("pool1", 2);
      mockPoolState.createPool("pool2", 3);

      const pools = mockPoolState.listPools();
      expect(pools).toHaveLength(3); // Including default-pool
    });

    it("should get specific pool by name", () => {
      mockPoolState.createPool("my-pool", 2);

      const pool = mockPoolState.getPool("my-pool");
      expect(pool).toBeDefined();
      expect(pool?.name).toBe("my-pool");
    });

    it("should update pool configuration", () => {
      mockPoolState.createPool("test-pool", 2);

      const updated = mockPoolState.updatePool("test-pool", { maxPods: 5 });
      expect(updated.maxPods).toBe(5);
    });

    it("should delete pool", () => {
      mockPoolState.createPool("temp-pool", 2);

      mockPoolState.deletePool("temp-pool");
      expect(mockPoolState.getPool("temp-pool")).toBeUndefined();
    });
  });

  describe("Pod Management", () => {
    it("should claim available pod from pool", () => {
      const pool = mockPoolState.createPool("test-pool", 2);
      const initialAvailable = pool.pods.filter(
        (p) => p.usage_status === "available"
      ).length;

      const pod = mockPoolState.claimPod("test-pool", "workspace-123");

      expect(pod).toBeDefined();
      expect(pod?.usage_status).toBe("in_use");
      expect(pod?.workspaceId).toBe("workspace-123");

      const updatedPool = mockPoolState.getPool("test-pool");
      const availableAfter = updatedPool?.pods.filter(
        (p) => p.usage_status === "available"
      ).length;
      expect(availableAfter).toBe(initialAvailable - 1);
    });

    it("should return null when no pods available", () => {
      mockPoolState.createPool("small-pool", 1);

      // Claim the only pod
      mockPoolState.claimPod("small-pool", "workspace-1");

      // Try to claim another
      const pod = mockPoolState.claimPod("small-pool", "workspace-2");
      expect(pod).toBeNull();
    });

    it("should release pod back to pool", () => {
      mockPoolState.createPool("test-pool", 2);
      const pod = mockPoolState.claimPod("test-pool", "workspace-123");

      expect(pod?.usage_status).toBe("in_use");

      const released = mockPoolState.releasePod("test-pool", pod!.id);
      expect(released).toBe(true);

      const updatedPod = mockPoolState.getPod("test-pool", pod!.id);
      expect(updatedPod?.usage_status).toBe("available");
      expect(updatedPod?.workspaceId).toBeUndefined();
    });

    it("should update pod repositories", () => {
      const pool = mockPoolState.createPool("test-pool", 1);
      const pod = pool.pods[0];

      const updated = mockPoolState.updatePodRepositories(
        "test-pool",
        pod.id,
        ["repo1", "repo2"],
        ["main", "develop"]
      );

      expect(updated).toBe(true);

      const updatedPod = mockPoolState.getPod("test-pool", pod.id);
      expect(updatedPod?.repositories).toEqual(["repo1", "repo2"]);
      expect(updatedPod?.branches).toEqual(["main", "develop"]);
    });

    it("should update pod environment variables", () => {
      const pool = mockPoolState.createPool("test-pool", 1);
      const pod = pool.pods[0];

      const updated = mockPoolState.updatePodEnvironment("test-pool", pod.id, {
        NODE_ENV: "production",
        API_KEY: "secret",
      });

      expect(updated).toBe(true);

      const updatedPod = mockPoolState.getPod("test-pool", pod.id);
      expect(updatedPod?.environmentVariables).toEqual({
        NODE_ENV: "production",
        API_KEY: "secret",
      });
    });
  });

  describe("User Management", () => {
    it("should create user", () => {
      const user = mockPoolState.createUser("testuser", "password123");

      expect(user.username).toBe("testuser");
      expect(user.password).toBe("password123");
      expect(user.createdAt).toBeInstanceOf(Date);
    });

    it("should not create duplicate user", () => {
      mockPoolState.createUser("testuser", "password123");

      expect(() => {
        mockPoolState.createUser("testuser", "password456");
      }).toThrow("User testuser already exists");
    });

    it("should delete user", () => {
      mockPoolState.createUser("testuser", "password123");

      const deleted = mockPoolState.deleteUser("testuser");
      expect(deleted).toBe(true);
      expect(mockPoolState.getUser("testuser")).toBeUndefined();
    });
  });

  describe("Authentication", () => {
    it("should login with valid credentials", () => {
      mockPoolState.createUser("testuser", "password123");

      const token = mockPoolState.login("testuser", "password123");
      expect(token).toBeDefined();
      expect(typeof token).toBe("string");
    });

    it("should not login with invalid credentials", () => {
      mockPoolState.createUser("testuser", "password123");

      const token = mockPoolState.login("testuser", "wrongpassword");
      expect(token).toBeNull();
    });

    it("should validate token", () => {
      mockPoolState.createUser("testuser", "password123");
      const token = mockPoolState.login("testuser", "password123");

      expect(token).toBeDefined();
      const valid = mockPoolState.validateToken(token!);
      expect(valid).toBe(true);
    });

    it("should reject invalid token", () => {
      const valid = mockPoolState.validateToken("invalid-token");
      expect(valid).toBe(false);
    });
  });

  describe("Command Execution", () => {
    it("should execute command on pod", () => {
      const pool = mockPoolState.createPool("test-pool", 1);
      const pod = pool.pods[0];

      const result = mockPoolState.executeCommand(
        "test-pool",
        pod.id,
        "npm install"
      );

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("npm install");
    });

    it("should fail command on non-existent pod", () => {
      const result = mockPoolState.executeCommand(
        "test-pool",
        "non-existent-pod",
        "ls"
      );

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });
  });

  describe("Process Management", () => {
    it("should get mock processes for pod", () => {
      const pool = mockPoolState.createPool("test-pool", 1);
      const pod = pool.pods[0];

      const processes = mockPoolState.getMockProcesses("test-pool", pod.id);

      expect(processes).toHaveLength(2);
      expect(processes[0].name).toBe("goose");
      expect(processes[0].status).toBe("online");
      expect(processes[1].name).toBe("frontend");
    });

    it("should return empty array for non-existent pod", () => {
      const processes = mockPoolState.getMockProcesses(
        "test-pool",
        "non-existent-pod"
      );

      expect(processes).toHaveLength(0);
    });
  });

  describe("State Reset", () => {
    it("should reset all state", () => {
      mockPoolState.createUser("user1", "pass1");
      mockPoolState.createPool("pool1", 2);

      mockPoolState.reset();

      expect(mockPoolState.getUser("user1")).toBeUndefined();
      expect(mockPoolState.getPool("pool1")).toBeUndefined();

      // Default pool should be recreated
      expect(mockPoolState.getPool("default-pool")).toBeDefined();
    });
  });
});
