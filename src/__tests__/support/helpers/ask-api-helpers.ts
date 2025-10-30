/**
 * Shared mock data and helpers for ask API route tests
 */

/**
 * Creates a mock user object for authentication tests
 */
export function createMockUser(overrides?: { id?: string; email?: string }) {
  return {
    id: overrides?.id || "user-123",
    email: overrides?.email || "test@example.com",
  };
}

/**
 * Creates a mock swarm object with encrypted API key
 */
export function createMockSwarm(overrides?: {
  id?: string;
  workspaceId?: string;
  swarmUrl?: string;
  swarmApiKey?: string;
}) {
  return {
    id: overrides?.id || "swarm-123",
    workspaceId: overrides?.workspaceId || "workspace-123",
    swarmUrl: overrides?.swarmUrl || "https://swarm.example.com",
    swarmApiKey:
      overrides?.swarmApiKey ||
      JSON.stringify({
        data: "encrypted-api-key",
        iv: "test-iv",
        tag: "test-tag",
        keyId: "k1",
      }),
  };
}

/**
 * Creates a mock workspace object
 */
export function createMockWorkspace(overrides?: {
  id?: string;
  slug?: string;
}) {
  return {
    id: overrides?.id || "workspace-123",
    slug: overrides?.slug || "test-workspace",
  };
}

/**
 * Creates a mock repository object
 */
export function createMockRepository(overrides?: {
  id?: string;
  repositoryUrl?: string;
}) {
  return {
    id: overrides?.id || "repo-123",
    repositoryUrl: overrides?.repositoryUrl || "https://github.com/test/repo",
  };
}

/**
 * Creates a mock GitHub profile with PAT
 */
export function createMockGithubProfile(overrides?: {
  username?: string;
  token?: string;
}) {
  return {
    username: overrides?.username || "testuser",
    token: overrides?.token || "github-pat-123",
  };
}

/**
 * Creates a mock session object for NextAuth
 */
export function createMockSession(overrides?: {
  userId?: string;
  userEmail?: string;
}) {
  return {
    user: {
      id: overrides?.userId || "user-123",
      email: overrides?.userEmail || "test@example.com",
    },
  };
}

/**
 * Creates a mock AI tools object
 */
export function createMockAITools() {
  return {
    get_learnings: { name: "get_learnings" },
    ask_question: { name: "ask_question" },
    recent_commits: { name: "recent_commits" },
    recent_contributions: { name: "recent_contributions" },
    web_search: { name: "web_search" },
    final_answer: { name: "final_answer" },
  };
}
