/**
 * Pool Manager Mock State Manager
 * Maintains in-memory state for mock pool operations
 */

interface MockPodWorkspace {
  id: string;
  poolName: string;
  fqdn: string;
  url: string;
  subdomain: string;
  password: string;
  state: "available" | "claimed" | "marked_for_recreation";
  usage_status: "free" | "used";
  portMappings: Record<string, string>;
  repositories: string[];
  branches: string[];
  primaryRepo: string;
  repoName: string;
  created: string;
  marked_at: string | null;
  claimedBy: string | null;
  claimedAt: string | null;
  image: string;
  customImage: boolean;
  useDevContainer: boolean;
  flagged_for_recreation: boolean;
}

interface MockPool {
  id: string;
  name: string;
  apiKey: string;
  totalPods: number;
  availablePods: number;
  claimedPods: number;
  pods: MockPodWorkspace[];
}

class PoolManagerMockState {
  private static instance: PoolManagerMockState;
  private pools: Map<string, MockPool> = new Map();
  private workspaces: Map<string, MockPodWorkspace> = new Map();

  private constructor() {
    this.initializeDefaultPools();
  }

  static getInstance(): PoolManagerMockState {
    if (!PoolManagerMockState.instance) {
      PoolManagerMockState.instance = new PoolManagerMockState();
    }
    return PoolManagerMockState.instance;
  }

  /**
   * Initialize with some default pools for testing
   */
  private initializeDefaultPools(): void {
    const defaultPool = this.createPool("default-pool", "mock-api-key-default");
    
    for (let i = 1; i <= 5; i++) {
      this.createPod(defaultPool.id, i);
    }
  }

  /**
   * Auto-create a pool if it doesn't exist
   * This allows any configuration to work without pre-seeding
   */
  getOrCreatePool(poolName: string, apiKey: string): MockPool {
    let pool = Array.from(this.pools.values()).find(p => p.name === poolName);
    
    if (!pool) {
      pool = this.createPool(poolName, apiKey);
      for (let i = 1; i <= 3; i++) {
        this.createPod(pool.id, i);
      }
    }
    
    return pool;
  }

  private createPool(name: string, apiKey: string): MockPool {
    const id = `pool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const pool: MockPool = {
      id,
      name,
      apiKey,
      totalPods: 0,
      availablePods: 0,
      claimedPods: 0,
      pods: [],
    };
    this.pools.set(id, pool);
    return pool;
  }

  private createPod(poolId: string, index: number): MockPodWorkspace {
    const pool = this.pools.get(poolId);
    if (!pool) throw new Error("Pool not found");

    const podId = `pod-${poolId}-${index}`;
    const subdomain = `mock-pod-${index}`;
    
    const pod: MockPodWorkspace = {
      id: podId,
      poolName: pool.name,
      fqdn: `${subdomain}.mock.sphinx.chat`,
      url: `https://${subdomain}.mock.sphinx.chat`,
      subdomain,
      password: "mock-password",
      state: "available",
      usage_status: "free",
      portMappings: {
        "15551": `https://${subdomain}.mock.sphinx.chat:15551`,
        "15552": `https://${subdomain}.mock.sphinx.chat:15552`,
        "3000": `https://${subdomain}.mock.sphinx.chat:3000`,
      },
      repositories: [],
      branches: [],
      primaryRepo: "",
      repoName: "",
      created: new Date().toISOString(),
      marked_at: null,
      claimedBy: null,
      claimedAt: null,
      image: "ghcr.io/stakwork/staklink-universal:latest",
      customImage: false,
      useDevContainer: false,
      flagged_for_recreation: false,
    };

    pool.pods.push(pod);
    pool.totalPods++;
    pool.availablePods++;
    this.workspaces.set(podId, pod);
    
    return pod;
  }

  /**
   * Claim an available pod from a pool
   */
  claimPod(poolName: string, workspaceId: string): MockPodWorkspace {
    const pool = Array.from(this.pools.values()).find(p => p.name === poolName);
    if (!pool) {
      throw new Error(`Pool ${poolName} not found`);
    }

    let availablePod = pool.pods.find(
      p => p.usage_status === "free" && p.state === "available"
    );

    if (!availablePod) {
      const newPod = this.createPod(pool.id, pool.pods.length + 1);
      availablePod = newPod;
    }

    availablePod.usage_status = "used";
    availablePod.claimedBy = workspaceId;
    availablePod.claimedAt = new Date().toISOString();
    
    pool.availablePods--;
    pool.claimedPods++;

    return availablePod;
  }

  /**
   * Release a claimed pod back to the pool
   */
  releasePod(podId: string): MockPodWorkspace {
    const pod = this.workspaces.get(podId);
    if (!pod) {
      throw new Error(`Pod ${podId} not found`);
    }

    const pool = Array.from(this.pools.values()).find(p => p.name === pod.poolName);
    if (!pool) {
      throw new Error(`Pool ${pod.poolName} not found`);
    }

    pod.usage_status = "free";
    pod.claimedBy = null;
    pod.claimedAt = null;
    pod.repositories = [];
    pod.branches = [];
    
    pool.availablePods++;
    pool.claimedPods--;

    return pod;
  }

  /**
   * Update pod repositories (simulates git sync)
   */
  updatePodRepositories(podId: string, repositories: string[]): void {
    const pod = this.workspaces.get(podId);
    if (!pod) {
      throw new Error(`Pod ${podId} not found`);
    }

    pod.repositories = repositories;
    if (repositories.length > 0) {
      pod.primaryRepo = repositories[0];
      pod.repoName = repositories[0].split("/").pop() || "";
    }
  }

  /**
   * Get pool status
   */
  getPoolStatus(poolName: string): {
    total: number;
    available: number;
    claimed: number;
    pods: MockPodWorkspace[];
  } {
    const pool = Array.from(this.pools.values()).find(p => p.name === poolName);
    if (!pool) {
      throw new Error(`Pool ${poolName} not found`);
    }

    return {
      total: pool.totalPods,
      available: pool.availablePods,
      claimed: pool.claimedPods,
      pods: pool.pods,
    };
  }

  /**
   * Get pod by ID
   */
  getPod(podId: string): MockPodWorkspace | undefined {
    return this.workspaces.get(podId);
  }

  /**
   * Find claimed pod by workspace ID
   */
  findClaimedPod(workspaceId: string): MockPodWorkspace | undefined {
    return Array.from(this.workspaces.values()).find(
      p => p.claimedBy === workspaceId
    );
  }

  /**
   * Reset state (for testing)
   */
  reset(): void {
    this.pools.clear();
    this.workspaces.clear();
    this.initializeDefaultPools();
  }
}

export const poolManagerState = PoolManagerMockState.getInstance();