import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { poolManagerState } from "@/app/api/mock/pool-manager/state";

describe("Pool Manager Mock - State Management", () => {
  beforeEach(() => {
    poolManagerState.reset();
  });

  describe("Pool Creation", () => {
    test("should auto-create pool when claiming pod", () => {
      const pool = poolManagerState.getOrCreatePool("test-pool", "test-key");
      
      expect(pool.name).toBe("test-pool");
      expect(pool.apiKey).toBe("test-key");
      expect(pool.pods.length).toBeGreaterThan(0);
      expect(pool.totalPods).toBeGreaterThan(0);
      expect(pool.availablePods).toBeGreaterThan(0);
      expect(pool.claimedPods).toBe(0);
    });

    test("should return existing pool if already created", () => {
      const pool1 = poolManagerState.getOrCreatePool("test-pool", "test-key");
      const pool2 = poolManagerState.getOrCreatePool("test-pool", "test-key");
      
      expect(pool1.id).toBe(pool2.id);
      expect(pool1.pods.length).toBe(pool2.pods.length);
    });

    test("should create default pool on initialization", () => {
      // Default pool is created in constructor
      const status = poolManagerState.getPoolStatus("default-pool");
      
      expect(status.total).toBeGreaterThan(0);
      expect(status.available).toBeGreaterThan(0);
      expect(status.claimed).toBe(0);
    });
  });

  describe("Pod Claiming", () => {
    test("should claim available pod from pool", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const pod = poolManagerState.claimPod("test-pool", "workspace-123");
      
      expect(pod.usage_status).toBe("used");
      expect(pod.claimedBy).toBe("workspace-123");
      expect(pod.claimedAt).toBeDefined();
      expect(pod.poolName).toBe("test-pool");
    });

    test("should decrease available pods count after claiming", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const statusBefore = poolManagerState.getPoolStatus("test-pool");
      
      poolManagerState.claimPod("test-pool", "workspace-123");
      
      const statusAfter = poolManagerState.getPoolStatus("test-pool");
      expect(statusAfter.available).toBe(statusBefore.available - 1);
      expect(statusAfter.claimed).toBe(statusBefore.claimed + 1);
    });

    test("should auto-create new pod if none available", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const statusBefore = poolManagerState.getPoolStatus("test-pool");
      
      // Claim all available pods
      for (let i = 0; i < statusBefore.available + 1; i++) {
        poolManagerState.claimPod("test-pool", `workspace-${i}`);
      }
      
      const statusAfter = poolManagerState.getPoolStatus("test-pool");
      expect(statusAfter.total).toBeGreaterThan(statusBefore.total);
    });

    test("should throw error for non-existent pool", () => {
      expect(() => {
        poolManagerState.claimPod("non-existent-pool", "workspace-123");
      }).toThrow("Pool non-existent-pool not found");
    });
  });

  describe("Pod Release", () => {
    test("should release claimed pod back to pool", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const pod = poolManagerState.claimPod("test-pool", "workspace-123");
      
      const released = poolManagerState.releasePod(pod.id);
      
      expect(released.usage_status).toBe("free");
      expect(released.claimedBy).toBeNull();
      expect(released.claimedAt).toBeNull();
      expect(released.repositories).toEqual([]);
      expect(released.branches).toEqual([]);
    });

    test("should increase available pods count after release", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const pod = poolManagerState.claimPod("test-pool", "workspace-123");
      const statusBefore = poolManagerState.getPoolStatus("test-pool");
      
      poolManagerState.releasePod(pod.id);
      
      const statusAfter = poolManagerState.getPoolStatus("test-pool");
      expect(statusAfter.available).toBe(statusBefore.available + 1);
      expect(statusAfter.claimed).toBe(statusBefore.claimed - 1);
    });

    test("should throw error for non-existent pod", () => {
      expect(() => {
        poolManagerState.releasePod("non-existent-pod");
      }).toThrow("Pod non-existent-pod not found");
    });
  });

  describe("Repository Updates", () => {
    test("should update pod repositories", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const pod = poolManagerState.claimPod("test-pool", "workspace-123");
      
      const repositories = ["owner/repo1", "owner/repo2"];
      poolManagerState.updatePodRepositories(pod.id, repositories);
      
      const updatedPod = poolManagerState.getPod(pod.id);
      expect(updatedPod?.repositories).toEqual(repositories);
      expect(updatedPod?.primaryRepo).toBe("owner/repo1");
      expect(updatedPod?.repoName).toBe("repo1");
    });

    test("should handle empty repository list", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const pod = poolManagerState.claimPod("test-pool", "workspace-123");
      
      poolManagerState.updatePodRepositories(pod.id, []);
      
      const updatedPod = poolManagerState.getPod(pod.id);
      expect(updatedPod?.repositories).toEqual([]);
      expect(updatedPod?.primaryRepo).toBe("");
      expect(updatedPod?.repoName).toBe("");
    });

    test("should throw error for non-existent pod", () => {
      expect(() => {
        poolManagerState.updatePodRepositories("non-existent-pod", ["repo"]);
      }).toThrow("Pod non-existent-pod not found");
    });
  });

  describe("Pool Status", () => {
    test("should return accurate pool status", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const pod1 = poolManagerState.claimPod("test-pool", "workspace-1");
      const pod2 = poolManagerState.claimPod("test-pool", "workspace-2");
      
      const status = poolManagerState.getPoolStatus("test-pool");
      
      expect(status.total).toBeGreaterThanOrEqual(2);
      expect(status.claimed).toBe(2);
      expect(status.available).toBe(status.total - 2);
      expect(status.pods.length).toBe(status.total);
    });

    test("should include all pods in status", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      poolManagerState.claimPod("test-pool", "workspace-1");
      
      const status = poolManagerState.getPoolStatus("test-pool");
      
      expect(status.pods).toBeDefined();
      expect(Array.isArray(status.pods)).toBe(true);
      
      const claimedPods = status.pods.filter(p => p.usage_status === "used");
      const availablePods = status.pods.filter(p => p.usage_status === "free");
      
      expect(claimedPods.length).toBe(status.claimed);
      expect(availablePods.length).toBe(status.available);
    });

    test("should throw error for non-existent pool", () => {
      expect(() => {
        poolManagerState.getPoolStatus("non-existent-pool");
      }).toThrow("Pool non-existent-pool not found");
    });
  });

  describe("Pod Retrieval", () => {
    test("should get pod by ID", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const pod = poolManagerState.claimPod("test-pool", "workspace-123");
      
      const retrieved = poolManagerState.getPod(pod.id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(pod.id);
    });

    test("should return undefined for non-existent pod", () => {
      const pod = poolManagerState.getPod("non-existent-pod");
      
      expect(pod).toBeUndefined();
    });

    test("should find claimed pod by workspace ID", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const pod = poolManagerState.claimPod("test-pool", "workspace-123");
      
      const found = poolManagerState.findClaimedPod("workspace-123");
      
      expect(found).toBeDefined();
      expect(found?.id).toBe(pod.id);
      expect(found?.claimedBy).toBe("workspace-123");
    });

    test("should return undefined when no pod claimed by workspace", () => {
      const found = poolManagerState.findClaimedPod("non-existent-workspace");
      
      expect(found).toBeUndefined();
    });
  });

  describe("Pod Properties", () => {
    test("should create pods with correct URLs and ports", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const pod = poolManagerState.claimPod("test-pool", "workspace-123");
      
      expect(pod.url).toContain("https://");
      expect(pod.url).toContain(".mock.sphinx.chat");
      expect(pod.fqdn).toContain(".mock.sphinx.chat");
      expect(pod.portMappings).toBeDefined();
      expect(Object.keys(pod.portMappings).length).toBeGreaterThan(0);
    });

    test("should create pods with default state", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const status = poolManagerState.getPoolStatus("test-pool");
      const availablePod = status.pods.find(p => p.usage_status === "free");
      
      expect(availablePod?.state).toBe("available");
      expect(availablePod?.usage_status).toBe("free");
      expect(availablePod?.claimedBy).toBeNull();
      expect(availablePod?.repositories).toEqual([]);
      expect(availablePod?.flagged_for_recreation).toBe(false);
    });

    test("should create pods with passwords", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const pod = poolManagerState.claimPod("test-pool", "workspace-123");
      
      expect(pod.password).toBeDefined();
      expect(typeof pod.password).toBe("string");
      expect(pod.password.length).toBeGreaterThan(0);
    });
  });

  describe("State Reset", () => {
    test("should reset all pools and workspaces", () => {
      poolManagerState.getOrCreatePool("test-pool-1", "test-key");
      poolManagerState.getOrCreatePool("test-pool-2", "test-key");
      poolManagerState.claimPod("test-pool-1", "workspace-1");
      
      poolManagerState.reset();
      
      // Should only have default pool after reset
      const status = poolManagerState.getPoolStatus("default-pool");
      expect(status.total).toBeGreaterThan(0);
      expect(status.claimed).toBe(0);
    });

    test("should reinitialize default pools after reset", () => {
      poolManagerState.reset();
      
      // Default pool should be available
      expect(() => {
        poolManagerState.getPoolStatus("default-pool");
      }).not.toThrow();
    });
  });

  describe("Complex Scenarios", () => {
    test("should handle multiple workspaces claiming from same pool", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      
      const pod1 = poolManagerState.claimPod("test-pool", "workspace-1");
      const pod2 = poolManagerState.claimPod("test-pool", "workspace-2");
      const pod3 = poolManagerState.claimPod("test-pool", "workspace-3");
      
      expect(pod1.id).not.toBe(pod2.id);
      expect(pod2.id).not.toBe(pod3.id);
      expect(pod1.claimedBy).toBe("workspace-1");
      expect(pod2.claimedBy).toBe("workspace-2");
      expect(pod3.claimedBy).toBe("workspace-3");
    });

    test("should handle claim-release-reclaim cycle", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      
      const pod1 = poolManagerState.claimPod("test-pool", "workspace-1");
      const podId = pod1.id;
      
      poolManagerState.releasePod(podId);
      
      const pod2 = poolManagerState.claimPod("test-pool", "workspace-2");
      
      // Should reuse the released pod
      expect(pod2.id).toBe(podId);
      expect(pod2.claimedBy).toBe("workspace-2");
    });

    test("should maintain accurate counts through multiple operations", () => {
      poolManagerState.getOrCreatePool("test-pool", "test-key");
      const initialStatus = poolManagerState.getPoolStatus("test-pool");
      
      // Claim 2 pods
      const pod1 = poolManagerState.claimPod("test-pool", "workspace-1");
      const pod2 = poolManagerState.claimPod("test-pool", "workspace-2");
      
      let status = poolManagerState.getPoolStatus("test-pool");
      expect(status.claimed).toBe(2);
      
      // Release 1 pod
      poolManagerState.releasePod(pod1.id);
      
      status = poolManagerState.getPoolStatus("test-pool");
      expect(status.claimed).toBe(1);
      expect(status.available).toBe(initialStatus.available - 1);
      
      // Claim again
      poolManagerState.claimPod("test-pool", "workspace-3");
      
      status = poolManagerState.getPoolStatus("test-pool");
      expect(status.claimed).toBe(2);
    });
  });
});
