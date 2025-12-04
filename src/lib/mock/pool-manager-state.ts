/**
 * Stateful mock manager for Pool Manager Service
 * Simulates pod claiming, releasing, environment updates, and repository management
 */

interface MockPod {
  id: string;
  state: "running" | "stopped";
  usage_status: "available" | "in_use";
  flagged_for_recreation: boolean;
  url: string;
  password: string;
  portMappings: Record<string, string>;
  repositories: string[];
  branches: string[];
  environmentVariables: Record<string, string>;
  username: string;
  claimedAt?: Date;
  workspaceId?: string;
  userInfo?: string;
}

interface MockPool {
  name: string;
  pods: MockPod[];
  maxPods: number;
}

interface MockUser {
  username: string;
  password: string;
  createdAt: Date;
}

class MockPoolStateManager {
  private pools: Map<string, MockPool> = new Map();
  private users: Map<string, MockUser> = new Map();
  private authTokens: Map<string, { username: string; expiresAt: Date }> =
    new Map();

  constructor() {
    // Initialize with a default pool
    this.createPool("default-pool", 5);
  }

  // Pool Management
  createPool(poolName: string, maxPods: number = 5): MockPool {
    if (this.pools.has(poolName)) {
      throw new Error(`Pool ${poolName} already exists`);
    }

    const pods: MockPod[] = [];
    for (let i = 0; i < maxPods; i++) {
      pods.push(this.createPod(poolName, i));
    }

    const pool: MockPool = {
      name: poolName,
      pods,
      maxPods,
    };

    this.pools.set(poolName, pool);
    return pool;
  }

  getPool(poolName: string): MockPool | undefined {
    return this.pools.get(poolName);
  }

  /**
   * Get or create a pool - used for dynamic pool creation when any pool name is requested
   * This allows the mock to work with any workspace configuration
   */
  getOrCreatePool(poolName: string, maxPods: number = 5): MockPool {
    const existing = this.pools.get(poolName);
    if (existing) {
      return existing;
    }
    return this.createPool(poolName, maxPods);
  }

  listPools(): MockPool[] {
    return Array.from(this.pools.values());
  }

  updatePool(poolName: string, updates: Partial<MockPool>): MockPool {
    const pool = this.pools.get(poolName);
    if (!pool) {
      throw new Error(`Pool ${poolName} not found`);
    }

    const updatedPool = { ...pool, ...updates };
    this.pools.set(poolName, updatedPool);
    return updatedPool;
  }

  deletePool(poolName: string): void {
    if (!this.pools.has(poolName)) {
      throw new Error(`Pool ${poolName} not found`);
    }
    this.pools.delete(poolName);
  }

  // Pod Management
  private createPod(poolName: string, index: number): MockPod {
    const podId = `${poolName}-pod-${index}`;
    // Use POD_URL env var for mock pods, fallback to localhost
    const podUrl = process.env.POD_URL || "http://localhost:3000";
    return {
      id: podId,
      state: "running",
      usage_status: "available",
      flagged_for_recreation: false,
      url: podUrl,
      password: `mock-password-${index}`,
      portMappings: {
        "3000": podUrl,
        "3001": podUrl,
        "5173": podUrl,
        "8080": podUrl,
      },
      repositories: [],
      branches: [],
      environmentVariables: {},
      username: `mock-user-${index}`,
    };
  }

  getAvailablePod(poolName: string): MockPod | null {
    const pool = this.pools.get(poolName);
    if (!pool) {
      return null;
    }

    const availablePod = pool.pods.find(
      (pod) => pod.usage_status === "available" && pod.state === "running"
    );

    return availablePod || null;
  }

  claimPod(poolName: string, workspaceId: string): MockPod | null {
    const pool = this.pools.get(poolName);
    if (!pool) {
      throw new Error(`Pool ${poolName} not found`);
    }

    const availablePod = pool.pods.find(
      (pod) => pod.usage_status === "available" && pod.state === "running"
    );

    if (!availablePod) {
      return null;
    }

    availablePod.usage_status = "in_use";
    availablePod.claimedAt = new Date();
    availablePod.workspaceId = workspaceId;

    return availablePod;
  }

  releasePod(poolName: string, podId: string): boolean {
    const pool = this.pools.get(poolName);
    if (!pool) {
      return false;
    }

    const pod = pool.pods.find((p) => p.id === podId);
    if (!pod) {
      return false;
    }

    // Reset pod state
    pod.usage_status = "available";
    pod.repositories = [];
    pod.branches = [];
    pod.environmentVariables = {};
    pod.claimedAt = undefined;
    pod.workspaceId = undefined;

    return true;
  }

  getPod(poolName: string, podId: string): MockPod | undefined {
    const pool = this.pools.get(poolName);
    if (!pool) {
      return undefined;
    }

    return pool.pods.find((p) => p.id === podId);
  }

  updatePodRepositories(
    poolName: string,
    podId: string,
    repositories: string[],
    branches: string[]
  ): boolean {
    const pod = this.getPod(poolName, podId);
    if (!pod) {
      return false;
    }

    pod.repositories = repositories;
    pod.branches = branches;
    return true;
  }

  updatePodEnvironment(
    poolName: string,
    podId: string,
    envVars: Record<string, string>
  ): boolean {
    const pod = this.getPod(poolName, podId);
    if (!pod) {
      return false;
    }

    pod.environmentVariables = { ...pod.environmentVariables, ...envVars };
    return true;
  }

  updatePodUserInfo(poolName: string, podId: string, userInfo: string): boolean {
    const pod = this.getPod(poolName, podId);
    if (!pod) {
      return false;
    }

    pod.userInfo = userInfo;
    return true;
  }

  // User Management
  createUser(username: string, password: string): MockUser {
    if (this.users.has(username)) {
      throw new Error(`User ${username} already exists`);
    }

    const user: MockUser = {
      username,
      password,
      createdAt: new Date(),
    };

    this.users.set(username, user);
    return user;
  }

  deleteUser(username: string): boolean {
    return this.users.delete(username);
  }

  getUser(username: string): MockUser | undefined {
    return this.users.get(username);
  }

  // Authentication
  login(username: string, password: string): string | null {
    const user = this.users.get(username);
    if (!user || user.password !== password) {
      return null;
    }

    const token = `mock-token-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    this.authTokens.set(token, { username, expiresAt });
    return token;
  }

  validateToken(token: string): boolean {
    const tokenData = this.authTokens.get(token);
    if (!tokenData) {
      return false;
    }

    if (tokenData.expiresAt < new Date()) {
      this.authTokens.delete(token);
      return false;
    }

    return true;
  }

  // Process Execution Simulation
  executeCommand(poolName: string, podId: string, command: string): {
    success: boolean;
    output: string;
    exitCode: number;
  } {
    const pod = this.getPod(poolName, podId);
    if (!pod) {
      return {
        success: false,
        output: "Pod not found",
        exitCode: 1,
      };
    }

    // Simulate command execution
    return {
      success: true,
      output: `Mock execution of command: ${command}\nPod: ${podId}\nStatus: completed`,
      exitCode: 0,
    };
  }

  // Get mock processes for a pod
  getMockProcesses(poolName: string, podId: string) {
    const pod = this.getPod(poolName, podId);
    if (!pod) {
      return [];
    }

    // Return mock processes similar to PM2 output
    return [
      {
        pid: 12345,
        name: "goose",
        status: "online",
        port: "3001",
        pm_uptime: 123456,
        cwd: "/home/jovyan/workspace",
      },
      {
        pid: 12346,
        name: "frontend",
        status: "online",
        port: "3000",
        pm_uptime: 123456,
        cwd: "/home/jovyan/workspace",
      },
    ];
  }

  // Reset all state (useful for testing)
  reset(): void {
    this.pools.clear();
    this.users.clear();
    this.authTokens.clear();
    this.createPool("default-pool", 5);
  }
}

// Singleton instance
export const mockPoolState = new MockPoolStateManager();
