/**
 * Mock GitHub State Manager
 * 
 * Manages in-memory state for mock GitHub API responses.
 * Follows the same pattern as MockPoolStateManager and MockStakworkState.
 * 
 * Features:
 * - Auto-creates resources when requested (users, repos, installations)
 * - Maintains consistent IDs and relationships
 * - Supports token lifecycle (creation, refresh)
 * - Webhook CRUD operations
 * - Stateful between requests within a test
 * - Resetable for test isolation
 */

export interface MockGitHubUser {
  login: string;
  id: number;
  node_id: string;
  avatar_url: string;
  type: "User" | "Organization";
  name: string;
  company: string | null;
  email: string;
  bio: string | null;
  public_repos: number;
  followers: number;
  following: number;
  created_at: string;
  updated_at: string;
}

export interface MockInstallation {
  id: number;
  account: {
    login: string;
    id: number;
    type: "User" | "Organization";
    avatar_url: string;
  };
  app_slug: string;
  target_type: string;
  permissions: {
    contents: string;
    metadata: string;
    pull_requests: string;
    webhooks: string;
  };
  events: string[];
  created_at: string;
  updated_at: string;
}

export interface MockRepository {
  id: number;
  node_id: string;
  name: string;
  full_name: string;
  owner: {
    login: string;
    id: number;
    type: "User" | "Organization";
    avatar_url: string;
  };
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
  permissions: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
  created_at: string;
  updated_at: string;
}

export interface MockWebhook {
  id: number;
  url: string;
  test_url: string;
  ping_url: string;
  name: "web";
  events: string[];
  active: boolean;
  config: {
    url: string;
    content_type: "json" | "form";
    insecure_ssl: "0" | "1";
    secret?: string;
  };
  created_at: string;
  updated_at: string;
}

export interface MockToken {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
  scope: string;
  token_type: "bearer";
  created_at: Date;
  revoked?: boolean;
  revokedAt?: string;
}

export interface MockBranch {
  name: string;
  commit: {
    sha: string;
    url: string;
  };
  protected: boolean;
}

export interface MockCommit {
  sha: string;
  node_id: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  author: {
    login: string;
    id: number;
    avatar_url: string;
  } | null;
  html_url: string;
}

interface MockAuthCode {
  code: string;
  clientId: string;
  scope: string;
  createdAt: Date;
  used: boolean;
}

class MockGitHubStateManager {
  private users: Map<string, MockGitHubUser> = new Map();
  private installations: Map<number, MockInstallation> = new Map();
  private repositories: Map<string, MockRepository> = new Map();
  private webhooks: Map<string, MockWebhook[]> = new Map();
  private tokens: Map<string, MockToken> = new Map();
  private branches: Map<string, MockBranch[]> = new Map();
  private commits: Map<string, MockCommit[]> = new Map();
  private authCodes: Map<string, MockAuthCode> = new Map();
  private authCodeCounter = 1000;

  private userIdCounter = 1000;
  private installationIdCounter = 1000;
  private repositoryIdCounter = 1000;
  private webhookIdCounter = 1000;
  private commitCounter = 1000;

  /**
   * Create or get a user. Auto-creates if doesn't exist.
   */
  createUser(login: string, type: "User" | "Organization" = "User"): MockGitHubUser {
    const existing = this.users.get(login);
    if (existing) return existing;

    const user: MockGitHubUser = {
      login,
      id: this.userIdCounter++,
      node_id: `MDQ6VXNlcjEwMDA=`,
      avatar_url: `https://avatars.githubusercontent.com/u/${this.userIdCounter}?v=4`,
      type,
      name: login.replace("-", " "),
      company: type === "Organization" ? login : null,
      email: `${login}@example.com`,
      bio: `Mock ${type} for testing`,
      public_repos: 10,
      followers: 5,
      following: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.users.set(login, user);
    return user;
  }

  getUser(login: string): MockGitHubUser | undefined {
    return this.users.get(login);
  }

  getUserById(id: number): MockGitHubUser | undefined {
    return Array.from(this.users.values()).find((u) => u.id === id);
  }

  /**
   * Create or get an installation. Auto-creates if doesn't exist.
   */
  createInstallation(
    owner: string,
    appSlug: string = "hive-app-test"
  ): MockInstallation {
    const user = this.createUser(owner);
    const existingInstallation = Array.from(this.installations.values()).find(
      (inst) => inst.account.login === owner
    );
    if (existingInstallation) return existingInstallation;

    const installation: MockInstallation = {
      id: this.installationIdCounter++,
      account: {
        login: user.login,
        id: user.id,
        type: user.type,
        avatar_url: user.avatar_url,
      },
      app_slug: appSlug,
      target_type: user.type === "Organization" ? "Organization" : "User",
      permissions: {
        contents: "write",
        metadata: "read",
        pull_requests: "write",
        webhooks: "write",
      },
      events: ["push", "pull_request", "issues"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.installations.set(installation.id, installation);
    return installation;
  }

  getInstallation(installationId: number): MockInstallation | undefined {
    return this.installations.get(installationId);
  }

  getInstallationsByOwner(owner: string): MockInstallation[] {
    return Array.from(this.installations.values()).filter(
      (inst) => inst.account.login === owner
    );
  }

  /**
   * Create an authorization code for OAuth flow
   */
  createAuthCode(params: { clientId: string; scope: string }): string {
    const code = `mock_auth_code_${this.authCodeCounter++}_${Date.now()}`;
    this.authCodes.set(code, {
      code,
      clientId: params.clientId,
      scope: params.scope,
      createdAt: new Date(),
      used: false,
    });
    return code;
  }

  /**
   * Exchange an authorization code for a token
   * Returns null if code is invalid or already used
   */
  exchangeAuthCode(code: string): { token: MockToken; scope: string } | null {
    const authCode = this.authCodes.get(code);
    if (!authCode || authCode.used) {
      return null;
    }

    // Mark code as used
    authCode.used = true;

    // Create and return token
    const token = this.createToken(code, authCode.scope);
    return { token, scope: authCode.scope };
  }

  /**
   * Create OAuth token from authorization code
   */
  createToken(code: string, scope: string = "repo,user,read:org"): MockToken {
    const token: MockToken = {
      access_token: `gho_mock_${code}_${Date.now()}`,
      expires_in: 28800, // 8 hours
      refresh_token: `ghr_mock_${code}_${Date.now()}`,
      refresh_token_expires_in: 15780000, // 6 months
      scope,
      token_type: "bearer",
      created_at: new Date(),
    };

    this.tokens.set(code, token);
    return token;
  }

  getTokenByCode(code: string): MockToken | undefined {
    const token = this.tokens.get(code);
    if (token && !token.revoked) {
      return token;
    }
    return undefined;
  }

  /**
   * Revoke a token by access token value
   * Returns true if token was found and revoked, false otherwise
   */
  revokeToken(accessToken: string): boolean {
    for (const [_code, token] of this.tokens.entries()) {
      if (token.access_token === accessToken) {
        // Return false if token is already revoked
        if (token.revoked) {
          return false;
        }
        token.revoked = true;
        token.revokedAt = new Date().toISOString();
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a token is revoked
   */
  isTokenRevoked(accessToken: string): boolean {
    for (const token of this.tokens.values()) {
      if (token.access_token === accessToken) {
        return token.revoked === true;
      }
    }
    return false;
  }

  /**
   * Refresh an existing token
   */
  refreshToken(refreshToken: string): MockToken | null {
    const existing = Array.from(this.tokens.values()).find(
      (t) => t.refresh_token === refreshToken
    );
    if (!existing) return null;

    const newToken: MockToken = {
      access_token: `gho_mock_refreshed_${Date.now()}`,
      expires_in: 28800,
      refresh_token: `ghr_mock_refreshed_${Date.now()}`,
      refresh_token_expires_in: 15780000,
      scope: existing.scope,
      token_type: "bearer",
      created_at: new Date(),
    };

    return newToken;
  }

  /**
   * Create or get a repository. Auto-creates if doesn't exist.
   */
  createRepository(
    owner: string,
    name: string,
    isPrivate: boolean = false,
    defaultBranch: string = "main"
  ): MockRepository {
    const repoKey = `${owner}/${name}`;
    const existing = this.repositories.get(repoKey);
    if (existing) return existing;

    const user = this.createUser(owner);
    const repository: MockRepository = {
      id: this.repositoryIdCounter++,
      node_id: `MDEwOlJlcG9zaXRvcnk=`,
      name,
      full_name: repoKey,
      owner: {
        login: user.login,
        id: user.id,
        type: user.type,
        avatar_url: user.avatar_url,
      },
      private: isPrivate,
      html_url: `https://github.com/${repoKey}`,
      description: `Mock repository for testing`,
      default_branch: defaultBranch,
      permissions: {
        admin: true,
        maintain: true,
        push: true,
        triage: true,
        pull: true,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.repositories.set(repoKey, repository);

    // Auto-create default branches
    this.createBranch(owner, name, defaultBranch, true);
    if (defaultBranch !== "dev") {
      this.createBranch(owner, name, "dev", false);
    }

    return repository;
  }

  getRepository(owner: string, name: string): MockRepository | undefined {
    return this.repositories.get(`${owner}/${name}`);
  }

  getRepositoriesByOwner(owner: string): MockRepository[] {
    return Array.from(this.repositories.values()).filter(
      (repo) => repo.owner.login === owner
    );
  }

  /**
   * Create a branch for a repository
   */
  createBranch(
    owner: string,
    repo: string,
    branchName: string,
    isProtected: boolean = false
  ): MockBranch {
    const repoKey = `${owner}/${repo}`;
    const branches = this.branches.get(repoKey) || [];

    const existing = branches.find((b) => b.name === branchName);
    if (existing) return existing;

    const branch: MockBranch = {
      name: branchName,
      commit: {
        sha: this.generateSha(),
        url: `https://api.github.com/repos/${repoKey}/commits/${this.generateSha()}`,
      },
      protected: isProtected,
    };

    branches.push(branch);
    this.branches.set(repoKey, branches);
    return branch;
  }

  getBranches(owner: string, repo: string): MockBranch[] {
    return this.branches.get(`${owner}/${repo}`) || [];
  }

  /**
   * Create commits for a repository
   */
  createCommits(owner: string, repo: string, count: number = 10): MockCommit[] {
    const repoKey = `${owner}/${repo}`;
    const existing = this.commits.get(repoKey);
    if (existing && existing.length > 0) return existing;

    const user = this.createUser(owner);
    const commits: MockCommit[] = [];

    for (let i = 0; i < count; i++) {
      const date = new Date(Date.now() - i * 86400000).toISOString(); // 1 day apart
      commits.push({
        sha: this.generateSha(),
        node_id: `MDY6Q29tbWl0`,
        commit: {
          author: {
            name: user.name,
            email: user.email,
            date,
          },
          committer: {
            name: user.name,
            email: user.email,
            date,
          },
          message: `Mock commit ${i + 1}`,
        },
        author: {
          login: user.login,
          id: user.id,
          avatar_url: user.avatar_url,
        },
        html_url: `https://github.com/${repoKey}/commit/${this.generateSha()}`,
      });
    }

    this.commits.set(repoKey, commits);
    return commits;
  }

  getCommits(owner: string, repo: string): MockCommit[] {
    const repoKey = `${owner}/${repo}`;
    const existing = this.commits.get(repoKey);
    if (existing) return existing;
    return this.createCommits(owner, repo);
  }

  /**
   * Create a webhook for a repository
   */
  createWebhook(
    owner: string,
    repo: string,
    config: {
      url: string;
      content_type?: "json" | "form";
      insecure_ssl?: "0" | "1";
      secret?: string;
    },
    events: string[] = ["push"]
  ): MockWebhook {
    const repoKey = `${owner}/${repo}`;
    const webhooks = this.webhooks.get(repoKey) || [];

    const webhook: MockWebhook = {
      id: this.webhookIdCounter++,
      url: `https://api.github.com/repos/${repoKey}/hooks/${this.webhookIdCounter}`,
      test_url: `https://api.github.com/repos/${repoKey}/hooks/${this.webhookIdCounter}/test`,
      ping_url: `https://api.github.com/repos/${repoKey}/hooks/${this.webhookIdCounter}/pings`,
      name: "web",
      events,
      active: true,
      config: {
        url: config.url,
        content_type: config.content_type || "json",
        insecure_ssl: config.insecure_ssl || "0",
        secret: config.secret,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    webhooks.push(webhook);
    this.webhooks.set(repoKey, webhooks);
    return webhook;
  }

  getWebhooks(owner: string, repo: string): MockWebhook[] {
    return this.webhooks.get(`${owner}/${repo}`) || [];
  }

  getWebhook(owner: string, repo: string, webhookId: number): MockWebhook | undefined {
    const webhooks = this.getWebhooks(owner, repo);
    return webhooks.find((w) => w.id === webhookId);
  }

  deleteWebhook(owner: string, repo: string, webhookId: number): boolean {
    const repoKey = `${owner}/${repo}`;
    const webhooks = this.webhooks.get(repoKey) || [];
    const index = webhooks.findIndex((w) => w.id === webhookId);

    if (index === -1) return false;

    webhooks.splice(index, 1);
    this.webhooks.set(repoKey, webhooks);
    return true;
  }

  /**
   * Search users by query
   */
  searchUsers(query: string): MockGitHubUser[] {
    const allUsers = Array.from(this.users.values());
    return allUsers.filter(
      (user) =>
        user.login.toLowerCase().includes(query.toLowerCase()) ||
        user.name.toLowerCase().includes(query.toLowerCase())
    );
  }

  /**
   * Reset all state (for test isolation)
   */
  reset(): void {
    this.users.clear();
    this.installations.clear();
    this.repositories.clear();
    this.webhooks.clear();
    this.tokens.clear();
    this.branches.clear();
    this.commits.clear();
    this.authCodes.clear();
    this.userIdCounter = 1000;
    this.installationIdCounter = 1000;
    this.repositoryIdCounter = 1000;
    this.webhookIdCounter = 1000;
    this.commitCounter = 1000;
    this.authCodeCounter = 1000;
  }

  /**
   * Generate a mock SHA
   */
  private generateSha(): string {
    return Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join("");
  }
}

// Export singleton instance
export const mockGitHubState = new MockGitHubStateManager();

// Export class for type checking and getInstance pattern
export const MockGitHubState = {
  getInstance: () => mockGitHubState
};
