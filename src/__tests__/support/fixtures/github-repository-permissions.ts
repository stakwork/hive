/**
 * Test fixtures and factories for GitHub repository permissions tests
 */
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { generateUniqueId } from "@/__tests__/support/helpers";

const encryptionService = EncryptionService.getInstance();

/**
 * Options for creating test user with GitHub tokens
 */
interface CreateTestUserWithTokensOptions {
  accessToken?: string;
  githubOwner?: string;
  githubInstallationId?: number;
}

/**
 * Creates a test user with GitHub tokens and source control org
 */
export async function createTestUserWithGitHubTokens(options?: CreateTestUserWithTokensOptions) {
  const {
    accessToken = "github_pat_test_token_123",
    githubOwner = "test-owner",
    githubInstallationId = 123456789,
  } = options || {};

  return await db.$transaction(async (tx) => {
    // Create test user
    const testUser = await tx.user.create({
      data: {
        id: generateUniqueId("test-user"),
        email: `test-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });

    // Create source control org for GitHub organization
    const sourceControlOrg = await tx.sourceControlOrg.create({
      data: {
        id: generateUniqueId("test-org"),
        githubLogin: githubOwner,
        githubInstallationId,
        name: `${githubOwner} Organization`,
        type: "USER", // Default to USER type
      },
    });

    // Create encrypted access token
    const encryptedToken = encryptionService.encryptField("source_control_token", accessToken);

    const sourceControlToken = await tx.sourceControlToken.create({
      data: {
        id: generateUniqueId("test-token"),
        userId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        token: JSON.stringify(encryptedToken),
      },
    });

    return { testUser, sourceControlOrg, sourceControlToken, accessToken };
  });
}

/**
 * Creates an additional source control org and token for an existing user
 */
export async function createAdditionalOrgForUser(
  userId: string,
  githubOwner: string,
  accessToken: string,
  githubInstallationId = 987654321,
) {
  return await db.$transaction(async (tx) => {
    const org = await tx.sourceControlOrg.create({
      data: {
        id: generateUniqueId(`${githubOwner}-org`),
        githubLogin: githubOwner,
        githubInstallationId,
        name: `${githubOwner} Organization`,
      },
    });

    const encryptedToken = encryptionService.encryptField("source_control_token", accessToken);

    const token = await tx.sourceControlToken.create({
      data: {
        id: generateUniqueId(`${githubOwner}-token`),
        userId,
        sourceControlOrgId: org.id,
        token: JSON.stringify(encryptedToken),
      },
    });

    return { org, token };
  });
}

/**
 * Mock access and refresh tokens
 */
export const mockAccessToken = "gho_test_access_token_12345";
export const mockRefreshToken = "gho_test_refresh_token_67890";

/**
 * Mock GitHub repository data builders
 */
export const mockGitHubRepository = {
  withPushPermissions(overrides = {}) {
    return {
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
      ...overrides,
    };
  },

  withFullPermissions(overrides = {}) {
    return {
      name: "test-repo",
      full_name: "test-owner/test-repo",
      private: false,
      default_branch: "main",
      permissions: {
        admin: true,
        maintain: true,
        push: true,
        triage: true,
        pull: true,
      },
      ...overrides,
    };
  },

  withMaintainPermissions(overrides = {}) {
    return {
      name: "test-repo",
      full_name: "test-owner/test-repo",
      private: false,
      default_branch: "main",
      permissions: {
        admin: false,
        maintain: true,
        push: false,
        triage: false,
        pull: true,
      },
      ...overrides,
    };
  },

  withReadOnlyPermissions(overrides = {}) {
    return {
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
      ...overrides,
    };
  },
};

/**
 * Mock GitHub API responses for different permission scenarios
 */
export const mockGitHubApiResponses = {
  pushPermission: {
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

  adminPermission: {
    ok: true,
    status: 200,
    json: async () => ({
      name: "test-repo",
      full_name: "test-owner/test-repo",
      private: true,
      default_branch: "main",
      permissions: {
        admin: true,
        maintain: false,
        push: false,
        triage: false,
        pull: true,
      },
    }),
  },

  maintainPermission: {
    ok: true,
    status: 200,
    json: async () => ({
      name: "test-repo",
      full_name: "test-owner/test-repo",
      private: false,
      default_branch: "main",
      permissions: {
        admin: false,
        maintain: true,
        push: false,
        triage: false,
        pull: true,
      },
    }),
  },

  pullOnlyPermission: {
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

  repositoryNotFound() {
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "Not Found",
    } as Response;
  },

  repositorySuccess(repoData: any) {
    return {
      ok: true,
      status: 200,
      json: async () => repoData,
    } as Response;
  },

  repositoryForbidden() {
    return {
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "Forbidden",
    } as Response;
  },

  repositoryServerError() {
    return {
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Internal Server Error",
    } as Response;
  },

  installationRepositoriesSuccess(repositories: Array<{ full_name: string }>) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        total_count: repositories.length,
        repositories,
      }),
    } as Response;
  },

  installationRepositoriesEmpty() {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        total_count: 0,
        repositories: [],
      }),
    } as Response;
  },

  installationRepositoriesError(status: number, statusText = "Error") {
    return {
      ok: false,
      status,
      statusText,
      text: async () => statusText,
    } as Response;
  },

  accessForbidden: {
    ok: false,
    status: 403,
    statusText: "Forbidden",
    text: async () => "Forbidden",
  },

  serverError: {
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    text: async () => "Internal Server Error",
  },
};

/**
 * Reset mocks before each test
 */
export function resetGitHubApiMocks() {
  // Clear any global fetch mocks
  if (global.fetch && typeof (global.fetch as any).mockClear === "function") {
    (global.fetch as any).mockClear();
  }
}

/**
 * Common test repository URLs for different scenarios
 */
export const testRepositoryUrls = {
  https: "https://github.com/test-owner/test-repo",
  httpsWithGit: "https://github.com/test-owner/test-repo.git",
  ssh: "git@github.com:nodejs/node.git",
  octocat: "https://github.com/octocat/Hello-World",
  invalid: "https://gitlab.com/test-owner/test-repo",
  malformed: "not-a-valid-url",
};
