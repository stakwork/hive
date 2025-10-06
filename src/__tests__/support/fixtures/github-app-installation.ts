/**
 * Test fixtures and factories for GitHub App installation tests
 */
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { generateUniqueId } from "@/__tests__/support/helpers";

const encryptionService = EncryptionService.getInstance();

/**
 * Options for creating test workspace with repository
 */
interface CreateTestWorkspaceWithRepoOptions {
  workspaceName?: string;
  workspaceSlug?: string;
  repositoryUrl?: string;
  ownerId: string;
  githubOwner?: string;
}

/**
 * Creates a test workspace with swarm and repository URL
 */
export async function createTestWorkspaceWithRepo(options: CreateTestWorkspaceWithRepoOptions) {
  const {
    workspaceName = "Test Workspace",
    workspaceSlug = `test-workspace-${generateUniqueId()}`,
    repositoryUrl = "https://github.com/test-owner/test-repo",
    ownerId,
    githubOwner = "test-owner",
  } = options;

  return await db.$transaction(async (tx) => {
    // Create workspace
    const workspace = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: workspaceName,
        slug: workspaceSlug,
        description: "Test workspace for GitHub App installation",
        ownerId,
      },
    });

    // Create swarm with repository URL
    const swarm = await tx.swarm.create({
      data: {
        id: generateUniqueId("swarm"),
        name: `test-swarm-${generateUniqueId()}`,
        workspaceId: workspace.id,
        repositoryUrl,
      },
    });

    return { workspace, swarm, githubOwner };
  });
}

/**
 * Creates test workspace with existing SourceControlOrg
 */
export async function createTestWorkspaceWithSourceControl(options: {
  ownerId: string;
  githubLogin: string;
  githubInstallationId: number;
  repositoryUrl?: string;
}) {
  const {
    ownerId,
    githubLogin,
    githubInstallationId,
    repositoryUrl = `https://github.com/${githubLogin}/test-repo`,
  } = options;

  return await db.$transaction(async (tx) => {
    // Create SourceControlOrg
    const sourceControlOrg = await tx.sourceControlOrg.create({
      data: {
        id: generateUniqueId("source-control-org"),
        githubLogin,
        githubInstallationId,
        name: `${githubLogin} Organization`,
        type: "ORG",
      },
    });

    // Create workspace linked to source control org
    const workspace = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Workspace with GitHub",
        slug: `workspace-${generateUniqueId()}`,
        description: "Workspace with existing GitHub connection",
        ownerId,
        sourceControlOrgId: sourceControlOrg.id,
      },
    });

    // Create swarm with repository URL
    const swarm = await tx.swarm.create({
      data: {
        id: generateUniqueId("swarm"),
        name: `test-swarm-${generateUniqueId()}`,
        workspaceId: workspace.id,
        repositoryUrl,
      },
    });

    return { workspace, swarm, sourceControlOrg };
  });
}

/**
 * Creates test user with GitHub App tokens for specific org
 */
export async function createTestUserWithAppTokens(options: {
  githubOwner: string;
  githubInstallationId?: number;
  accessToken?: string;
  refreshToken?: string;
}) {
  const {
    githubOwner,
    githubInstallationId = 123456789,
    accessToken = "ghu_test_access_token_123",
    refreshToken = "ghr_test_refresh_token_456",
  } = options;

  return await db.$transaction(async (tx) => {
    // Create test user
    const testUser = await tx.user.create({
      data: {
        id: generateUniqueId("test-user"),
        email: `test-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });

    // Create source control org
    const sourceControlOrg = await tx.sourceControlOrg.create({
      data: {
        id: generateUniqueId("source-control-org"),
        githubLogin: githubOwner,
        githubInstallationId,
        name: `${githubOwner} Organization`,
        type: "ORG",
      },
    });

    // Encrypt tokens
    const encryptedAccessToken = encryptionService.encryptField(
      "source_control_token",
      accessToken
    );
    const encryptedRefreshToken = encryptionService.encryptField(
      "source_control_refresh_token",
      refreshToken
    );

    // Create source control token
    const sourceControlToken = await tx.sourceControlToken.create({
      data: {
        id: generateUniqueId("source-control-token"),
        userId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        token: JSON.stringify(encryptedAccessToken),
        refreshToken: JSON.stringify(encryptedRefreshToken),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
      },
    });

    return {
      testUser,
      sourceControlOrg,
      sourceControlToken,
      accessToken,
      refreshToken,
    };
  });
}

/**
 * Creates test session with GitHub state
 */
export async function createTestSessionWithState(userId: string, state: string) {
  return await db.session.create({
    data: {
      id: generateUniqueId("session"),
      userId,
      sessionToken: generateUniqueId("session-token"),
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      githubState: state,
    },
  });
}

/**
 * Generate CSRF state for testing
 */
export function generateTestState(options: {
  workspaceSlug: string;
  repositoryUrl?: string;
  timestamp?: number;
}): string {
  const {
    workspaceSlug,
    repositoryUrl,
    timestamp = Date.now(),
  } = options;

  const stateData = {
    workspaceSlug,
    ...(repositoryUrl && { repositoryUrl }),
    randomState: "test-random-state-123",
    timestamp,
  };

  return Buffer.from(JSON.stringify(stateData)).toString("base64");
}

/**
 * Generate expired state for testing
 */
export function generateExpiredState(workspaceSlug: string): string {
  const oneHourAgo = Date.now() - (61 * 60 * 1000); // 61 minutes ago
  return generateTestState({ workspaceSlug, timestamp: oneHourAgo });
}

/**
 * Mock GitHub API responses for installation flow
 */
export const mockGitHubInstallationResponses = {
  // OAuth token exchange success
  tokenExchangeSuccess: {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: "ghu_new_access_token_from_oauth",
      refresh_token: "ghr_new_refresh_token_from_oauth",
      expires_in: 28800, // 8 hours
      refresh_token_expires_in: 15897600, // 6 months
      token_type: "bearer",
      scope: "repo,read:org",
    }),
  },

  // OAuth token exchange failure
  tokenExchangeFailed: {
    ok: false,
    status: 401,
    json: async () => ({
      error: "bad_verification_code",
      error_description: "The code passed is incorrect or expired.",
    }),
  },

  // GitHub user info success
  userInfoSuccess: {
    ok: true,
    status: 200,
    json: async () => ({
      login: "testuser",
      id: 123456,
      node_id: "MDQ6VXNlcjEyMzQ1Ng==",
      avatar_url: "https://avatars.githubusercontent.com/u/123456",
      name: "Test User",
      email: "test@example.com",
      type: "User",
    }),
  },

  // GitHub user installations success
  installationsSuccess: (installationId: number, githubOwner: string, type: "User" | "Organization" = "Organization") => ({
    ok: true,
    status: 200,
    json: async () => ({
      total_count: 1,
      installations: [
        {
          id: installationId,
          account: {
            login: githubOwner,
            id: 78910,
            node_id: "MDEyOk9yZ2FuaXphdGlvbjc4OTEw",
            avatar_url: `https://avatars.githubusercontent.com/u/78910`,
            type,
            name: `${githubOwner} Organization`,
            description: "Test organization",
          },
          app_id: 123,
          target_type: type,
          permissions: {
            contents: "read",
            metadata: "read",
            pull_requests: "write",
          },
          events: ["push", "pull_request"],
          created_at: "2023-01-01T00:00:00Z",
          updated_at: "2023-01-01T00:00:00Z",
        },
      ],
    }),
  }),

  // GitHub user info failed
  userInfoFailed: {
    ok: false,
    status: 401,
    statusText: "Unauthorized",
  },

  // GitHub installation not found
  installationNotFound: {
    ok: false,
    status: 404,
    statusText: "Not Found",
  },

  // Check user/org type
  checkOwnerTypeUser: (owner: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      login: owner,
      id: 12345,
      type: "User",
      name: owner,
    }),
  }),

  checkOwnerTypeOrg: (owner: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      login: owner,
      id: 67890,
      type: "Organization",
      name: `${owner} Organization`,
    }),
  }),

  // Installation endpoint for org
  orgInstallationSuccess: (installationId: number) => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: installationId,
      account: {
        login: "test-org",
        type: "Organization",
      },
    }),
  }),

  // Installation endpoint for user
  userInstallationSuccess: (installationId: number) => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: installationId,
      account: {
        login: "testuser",
        type: "User",
      },
    }),
  }),

  // No installation found
  noInstallation: {
    ok: false,
    status: 404,
    statusText: "Not Found",
  },

  // Repository access check - has access
  repositoryAccessSuccess: {
    ok: true,
    status: 200,
    json: async () => ({
      name: "test-repo",
      full_name: "test-owner/test-repo",
      private: false,
      default_branch: "main",
      permissions: {
        admin: false,
        maintain: false,
        push: true,
        triage: false,
        pull: true,
      },
    }),
  },

  // Repository access check - read only
  repositoryAccessReadOnly: {
    ok: true,
    status: 200,
    json: async () => ({
      name: "test-repo",
      full_name: "test-owner/test-repo",
      private: false,
      default_branch: "main",
      permissions: {
        admin: false,
        maintain: false,
        push: false,
        triage: false,
        pull: true,
      },
    }),
  },

  // Repository not found
  repositoryNotFound: {
    ok: false,
    status: 404,
    statusText: "Not Found",
  },
};

/**
 * Test repository URLs for various formats
 */
export const testRepositoryUrls = {
  https: "https://github.com/test-owner/test-repo",
  httpsWithGit: "https://github.com/test-owner/test-repo.git",
  ssh: "git@github.com:test-owner/test-repo.git",
  httpsOctocat: "https://github.com/octocat/Hello-World",
  httpsUser: "https://github.com/testuser/user-repo",
  invalid: "https://gitlab.com/test-owner/test-repo",
  malformed: "not-a-valid-url",
  noOwner: "https://github.com/test-repo",
};

/**
 * Mock getAccessToken function response
 */
export function mockGetAccessTokenSuccess() {
  return {
    userAccessToken: "ghu_new_access_token_from_oauth",
    userRefreshToken: "ghr_new_refresh_token_from_oauth",
  };
}

/**
 * Mock getAccessToken function failure
 */
export function mockGetAccessTokenFailure() {
  return {
    userAccessToken: null,
    userRefreshToken: null,
  };
}