interface StakworkSession {
  user?: { id?: string } | null;
}

interface StakworkWorkspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
}

interface StakworkWorkspaceData {
  id: string;
  slug: string;
}

interface StakworkSwarm {
  id: string;
  swarmUrl: string;
  swarmSecretAlias: string | null;
  poolName: string | null;
}

interface StakworkGithubProfile {
  username: string;
  token: string;
}

/**
 * Creates a mock session for Stakwork API tests
 */
export const createMockSession = (userId?: string): StakworkSession => ({
  user: userId ? { id: userId } : {},
});

/**
 * Creates a mock workspace for Stakwork API tests
 */
export const createMockWorkspace = (overrides: Partial<StakworkWorkspace> = {}): StakworkWorkspace => ({
  id: "workspace-456",
  name: "Test Workspace",
  slug: "test-workspace",
  ownerId: "user-123",
  ...overrides,
});

/**
 * Creates mock workspace data for database queries
 */
export const createMockWorkspaceData = (overrides: Partial<StakworkWorkspaceData> = {}): StakworkWorkspaceData => ({
  id: "workspace-456",
  slug: "test-workspace",
  ...overrides,
});

/**
 * Creates a mock swarm for Stakwork API tests
 */
export const createMockSwarm = (overrides: Partial<StakworkSwarm> = {}): StakworkSwarm => ({
  id: "swarm-789",
  swarmUrl: "https://test-swarm.sphinx.chat/api",
  swarmSecretAlias: "SWARM_SECRET",
  poolName: "test-pool",
  ...overrides,
});

/**
 * Creates a mock GitHub profile for Stakwork API tests
 */
export const createMockGithubProfile = (overrides: Partial<StakworkGithubProfile> = {}): StakworkGithubProfile => ({
  username: "testuser",
  token: "github-token-123",
  ...overrides,
});
