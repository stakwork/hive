/**
 * In-memory state manager for Pool Manager mock endpoints
 * This singleton maintains pool lifecycle and data for testing/development
 */

interface MockPool {
  id: string;
  name: string;
  description?: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  status: "active" | "archived" | "deleted";
  // Pool configuration
  config: {
    minimum_vms: number;
    repo_name: string;
    branch_name: string;
    github_pat: string;
    github_username: string;
    env_vars: Array<{ name: string; value: string; masked?: boolean }>;
    container_files: Record<string, string>;
    poolCpu?: string;
    poolMemory?: string;
  };
  // Pool status tracking
  metrics: {
    running_vms: number;
    pending_vms: number;
    failed_vms: number;
    used_vms: number;
    unused_vms: number;
    last_check: string;
  };
}

class PoolManagerStateManager {
  private static instance: PoolManagerStateManager;
  private pools: Map<string, MockPool> = new Map();

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): PoolManagerStateManager {
    if (!PoolManagerStateManager.instance) {
      PoolManagerStateManager.instance = new PoolManagerStateManager();
    }
    return PoolManagerStateManager.instance;
  }

  /**
   * Create a new pool
   */
  createPool(data: {
    pool_name: string;
    minimum_vms: number;
    repo_name: string;
    branch_name: string;
    github_pat: string;
    github_username: string;
    env_vars: Array<{ name: string; value: string }>;
    container_files: Record<string, string>;
  }): MockPool {
    const now = new Date().toISOString();
    const pool: MockPool = {
      id: `pool-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      name: data.pool_name,
      description: `Mock pool for ${data.repo_name}`,
      owner_id: "mock-owner-id",
      created_at: now,
      updated_at: now,
      status: "active",
      config: {
        minimum_vms: data.minimum_vms,
        repo_name: data.repo_name,
        branch_name: data.branch_name,
        github_pat: "***MASKED***", // Always mask sensitive data
        github_username: data.github_username,
        env_vars: data.env_vars.map((env) => ({
          name: env.name,
          value: this.maskSensitiveValue(env.name, env.value),
          masked: this.isSensitiveField(env.name),
        })),
        container_files: data.container_files,
      },
      metrics: {
        running_vms: data.minimum_vms, // Mock: all VMs are running
        pending_vms: 0,
        failed_vms: 0,
        used_vms: 0,
        unused_vms: data.minimum_vms,
        last_check: now,
      },
    };

    this.pools.set(data.pool_name, pool);
    return pool;
  }

  /**
   * Get a pool by name
   */
  getPool(name: string): MockPool | undefined {
    return this.pools.get(name);
  }

  /**
   * Delete a pool by name
   */
  deletePool(name: string): MockPool | undefined {
    const pool = this.pools.get(name);
    if (pool) {
      pool.status = "deleted";
      pool.updated_at = new Date().toISOString();
      this.pools.delete(name);
      return pool;
    }
    return undefined;
  }

  /**
   * Update pool environment variables
   */
  updatePoolEnvVars(
    name: string,
    envVars: Array<{ name: string; value: string; masked?: boolean }>,
    poolCpu?: string,
    poolMemory?: string,
    github_pat?: string,
    github_username?: string,
  ): boolean {
    const pool = this.pools.get(name);
    if (!pool) {
      return false;
    }

    pool.config.env_vars = envVars.map((env) => ({
      name: env.name,
      value: env.masked ? env.value : this.maskSensitiveValue(env.name, env.value),
      masked: env.masked ?? this.isSensitiveField(env.name),
    }));

    if (poolCpu) pool.config.poolCpu = poolCpu;
    if (poolMemory) pool.config.poolMemory = poolMemory;
    if (github_pat) pool.config.github_pat = "***MASKED***";
    if (github_username) pool.config.github_username = github_username;

    pool.updated_at = new Date().toISOString();
    return true;
  }

  /**
   * Get pool status
   */
  getPoolStatus(name: string): MockPool["metrics"] | undefined {
    const pool = this.pools.get(name);
    return pool?.metrics;
  }

  /**
   * List all active pools
   */
  listPools(): MockPool[] {
    return Array.from(this.pools.values()).filter(
      (pool) => pool.status === "active"
    );
  }

  /**
   * Clear all pools (for testing)
   */
  clear(): void {
    this.pools.clear();
  }

  /**
   * Mask sensitive values
   */
  private maskSensitiveValue(key: string, value: string): string {
    if (this.isSensitiveField(key)) {
      return "***MASKED***";
    }
    return value;
  }

  /**
   * Check if a field name indicates sensitive data
   */
  private isSensitiveField(name: string): boolean {
    const sensitivePatterns = [
      /password/i,
      /secret/i,
      /token/i,
      /key/i,
      /pat/i,
      /api[_-]?key/i,
      /auth/i,
    ];
    return sensitivePatterns.some((pattern) => pattern.test(name));
  }
}

// Export singleton instance
export const poolManagerState = PoolManagerStateManager.getInstance();
