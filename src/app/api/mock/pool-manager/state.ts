/**
 * Mock Pool Manager State Manager
 *
 * Maintains in-memory state for pools, workspaces (pods), and their usage status.
 * Auto-creates resources on demand to support any configuration without pre-seeding.
 */

interface MockPodWorkspace {
  id: string;
  fqdn: string;
  subdomain: string;
  url: string;
  password: string;
  state: "running" | "stopped";
  usage_status: "available" | "in-use";
  created: string;
  marked_at: string | null;
  primaryRepo: string;
  repoName: string;
  repositories: string[];
  branches: string[];
  image: string;
  customImage: boolean;
  useDevContainer: boolean;
  flagged_for_recreation: boolean;
  portMappings: Record<string, string>;
}

interface MockPool {
  name: string;
  owner: string;
  minimum_vms: number;
  repo_name: string;
  branch_name: string;
  github_username: string;
  env_vars: Array<{ name: string; value: string; masked: boolean }>;
  workspaces: MockPodWorkspace[];
  created_at: string;
}

interface MockUser {
  username: string;
  email: string;
  authentication_token: string;
  pools: string[];
}

class PoolManagerMockState {
  private static instance: PoolManagerMockState;
  private users: Map<string, MockUser> = new Map();
  private pools: Map<string, MockPool> = new Map();
  private authTokens: Map<string, string> = new Map(); // token -> username

  private constructor() {
    // Initialize with default admin user
    this.createUser({
      username: "admin",
      email: "admin@mock.dev",
      password: "mock-password",
    });
  }

  static getInstance(): PoolManagerMockState {
    if (!PoolManagerMockState.instance) {
      PoolManagerMockState.instance = new PoolManagerMockState();
    }
    return PoolManagerMockState.instance;
  }

  reset() {
    this.users.clear();
    this.pools.clear();
    this.authTokens.clear();
    // Re-initialize default user
    this.createUser({
      username: "admin",
      email: "admin@mock.dev",
      password: "mock-password",
    });
  }

  // User Operations
  createUser(data: {
    username: string;
    email: string;
    password: string;
  }): MockUser {
    const token = `mock-token-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const user: MockUser = {
      username: data.username,
      email: data.email,
      authentication_token: token,
      pools: [],
    };
    this.users.set(data.username, user);
    this.authTokens.set(token, data.username);
    return user;
  }

  authenticateUser(username: string, password: string): string | null {
    const user = this.users.get(username);
    // In mock mode, any password works for simplicity
    if (user) {
      return user.authentication_token;
    }
    return null;
  }

  getUserByToken(token: string): MockUser | null {
    const username = this.authTokens.get(token);
    if (username) {
      return this.users.get(username) || null;
    }
    return null;
  }

  // Pool Operations
  createPool(data: {
    pool_name: string;
    minimum_vms: number;
    repo_name: string;
    branch_name: string;
    github_username: string;
    env_vars: Array<{ name: string; value: string; masked: boolean }>;
    owner: string;
  }): MockPool {
    const pool: MockPool = {
      name: data.pool_name,
      owner: data.owner,
      minimum_vms: data.minimum_vms,
      repo_name: data.repo_name,
      branch_name: data.branch_name,
      github_username: data.github_username,
      env_vars: data.env_vars,
      workspaces: [],
      created_at: new Date().toISOString(),
    };

    // Auto-create minimum number of workspaces
    for (let i = 0; i < data.minimum_vms; i++) {
      pool.workspaces.push(
        this.createMockWorkspace(data.pool_name, i, data.repo_name)
      );
    }

    this.pools.set(data.pool_name, pool);

    // Add pool to owner's list
    const user = this.users.get(data.owner);
    if (user) {
      user.pools.push(data.pool_name);
    }

    return pool;
  }

  getPool(poolName: string): MockPool | null {
    return this.pools.get(poolName) || null;
  }

  deletePool(poolName: string): boolean {
    const pool = this.pools.get(poolName);
    if (!pool) return false;

    // Remove from owner's pool list
    const user = this.users.get(pool.owner);
    if (user) {
      user.pools = user.pools.filter((p) => p !== poolName);
    }

    this.pools.delete(poolName);
    return true;
  }

  // Workspace (Pod) Operations
  claimWorkspace(poolName: string): MockPodWorkspace | null {
    let pool = this.pools.get(poolName);
    if (!pool) {
      // Auto-create pool if it doesn't exist
      const newPool = this.createPool({
        pool_name: poolName,
        minimum_vms: 2,
        repo_name: "https://github.com/default/repo",
        branch_name: "main",
        github_username: "default",
        env_vars: [],
        owner: "admin",
      });
      pool = newPool;
    }

    // Find an available workspace
    let workspace = pool.workspaces.find((w) => w.usage_status === "available");

    // If none available, create a new one
    if (!workspace) {
      workspace = this.createMockWorkspace(
        poolName,
        pool.workspaces.length,
        pool.repo_name
      );
      pool.workspaces.push(workspace);
    }

    // Mark as in-use
    workspace.usage_status = "in-use";
    workspace.marked_at = new Date().toISOString();

    return workspace;
  }

  getWorkspace(workspaceId: string): MockPodWorkspace | null {
    for (const pool of this.pools.values()) {
      const workspace = pool.workspaces.find((w) => w.id === workspaceId);
      if (workspace) return workspace;
    }
    return null;
  }

  markWorkspaceUsed(poolName: string, workspaceId: string): boolean {
    const pool = this.pools.get(poolName);
    if (!pool) return false;

    const workspace = pool.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) return false;

    workspace.usage_status = "in-use";
    workspace.marked_at = new Date().toISOString();
    return true;
  }

  markWorkspaceUnused(poolName: string, workspaceId: string): boolean {
    const pool = this.pools.get(poolName);
    if (!pool) return false;

    const workspace = pool.workspaces.find((w) => w.id === workspaceId);
    if (!workspace) return false;

    workspace.usage_status = "available";
    workspace.marked_at = new Date().toISOString();
    return true;
  }

  // Helper: Create mock workspace
  private createMockWorkspace(
    poolName: string,
    index: number,
    repoName: string
  ): MockPodWorkspace {
    const id = `mock-workspace-${poolName}-${index}-${Date.now()}`;
    const subdomain = `${poolName}-${index}`;
    const repoShortName = repoName.split("/").pop() || "repo";

    return {
      id,
      fqdn: `${subdomain}.mock.sphinx.chat`,
      subdomain,
      url: `https://${subdomain}.mock.sphinx.chat`,
      password: `mock-pass-${index}`,
      state: "running",
      usage_status: "available",
      created: new Date().toISOString(),
      marked_at: null,
      primaryRepo: repoName,
      repoName: repoShortName,
      repositories: [repoName],
      branches: ["main"],
      image: "mock-ubuntu-image:latest",
      customImage: false,
      useDevContainer: false,
      flagged_for_recreation: false,
      portMappings: {
        "3000": `${30000 + index}`, // frontend
        "15551": `${15551 + index}`, // goose
        "15552": `${15552 + index}`, // control
        "8080": `${18080 + index}`, // ide
      },
    };
  }
}

export const poolManagerState = PoolManagerMockState.getInstance();