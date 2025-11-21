/**
 * Test fixtures and factories for GitHub repository numofcommits tests
 */
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { generateUniqueId } from "@/__tests__/support/helpers";

const encryptionService = EncryptionService.getInstance();

/**
 * Options for creating test user with GitHub credentials
 */
interface CreateTestUserWithGitHubCredsOptions {
  accessToken?: string;
  githubUsername?: string;
}

/**
 * Creates a test user with GitHub authentication
 */
export async function createTestUserWithGitHubCreds(options?: CreateTestUserWithGitHubCredsOptions) {
  const { accessToken = "github_pat_test_token_123", githubUsername = "test-user" } = options || {};

  return await db.$transaction(async (tx) => {
    const testUser = await tx.user.create({
      data: {
        id: generateUniqueId("test-user"),
        email: `test-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });

    await tx.gitHubAuth.create({
      data: {
        id: generateUniqueId("github-auth"),
        userId: testUser.id,
        githubUserId: generateUniqueId("github-user-id"),
        githubUsername,
      },
    });

    const encryptedToken = encryptionService.encryptField("access_token", accessToken);

    const account = await tx.account.create({
      data: {
        id: generateUniqueId("account"),
        userId: testUser.id,
        type: "oauth",
        provider: "github",
        providerAccountId: generateUniqueId("provider-account"),
        access_token: JSON.stringify(encryptedToken),
      },
    });

    return { testUser, account, accessToken, githubUsername };
  });
}

/**
 * Mock GitHub API responses for different scenarios
 */
export const mockGitHubApiResponses = {
  // Repository with default branch "main"
  repositoryMain: {
    data: {
      name: "test-repo",
      full_name: "test-owner/test-repo",
      private: false,
      default_branch: "main",
    },
  },

  // Repository with default branch "master"
  repositoryMaster: {
    data: {
      name: "legacy-repo",
      full_name: "test-owner/legacy-repo",
      private: true,
      default_branch: "master",
    },
  },

  // Commits response with pagination (many commits)
  commitsWithPagination: {
    data: [
      {
        sha: "abc123",
        commit: { message: "Initial commit" },
      },
    ],
    headers: {
      link: '<https://api.github.com/repos/test-owner/test-repo/commits?page=2>; rel="next", <https://api.github.com/repos/test-owner/test-repo/commits?page=1523>; rel="last"',
    },
  },

  // Commits response without pagination (few commits)
  commitsNoPagination: {
    data: [
      {
        sha: "abc123",
        commit: { message: "Initial commit" },
      },
    ],
    headers: {},
  },

  // Last week commits response
  lastWeekCommits: (count: number) => ({
    data: Array.from({ length: count }, (_, i) => ({
      sha: `commit${i}`,
      commit: { message: `Commit ${i}` },
    })),
    headers: {},
  }),

  // Last week commits with pagination
  lastWeekCommitsPaginated: {
    data: Array.from({ length: 100 }, (_, i) => ({
      sha: `commit${i}`,
      commit: { message: `Commit ${i}` },
    })),
    headers: {
      link: '<https://api.github.com/repos/test-owner/test-repo/commits?page=2>; rel="next", <https://api.github.com/repos/test-owner/test-repo/commits?page=3>; rel="last"',
    },
  },

  // Empty repository (no commits)
  emptyRepository: {
    data: [],
    headers: {},
  },
};

/**
 * Mock axios error responses
 */
export const mockAxiosErrors = {
  repositoryNotFound: {
    response: {
      status: 404,
      statusText: "Not Found",
      data: { message: "Not Found" },
    },
  },

  accessForbidden: {
    response: {
      status: 403,
      statusText: "Forbidden",
      data: { message: "Resource not accessible" },
    },
  },

  rateLimitExceeded: {
    response: {
      status: 403,
      statusText: "Forbidden",
      data: { message: "API rate limit exceeded" },
      headers: {
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": Math.floor(Date.now() / 1000) + 3600,
      },
    },
  },

  invalidToken: {
    response: {
      status: 401,
      statusText: "Unauthorized",
      data: { message: "Bad credentials" },
    },
  },

  serverError: {
    response: {
      status: 500,
      statusText: "Internal Server Error",
      data: { message: "Internal server error" },
    },
  },

  networkError: new Error("Network error: ECONNREFUSED"),
};

/**
 * Common test repository URLs
 */
export const testRepositoryUrls = {
  https: "https://github.com/test-owner/test-repo",
  httpsWithGit: "https://github.com/test-owner/test-repo.git",
  ssh: "git@github.com:test-owner/test-repo.git",
  sshNoGit: "git@github.com:test-owner/test-repo",
  octocat: "https://github.com/octocat/Hello-World",
  nodejs: "git@github.com:nodejs/node.git",
  invalid: "https://gitlab.com/test-owner/test-repo",
  malformed: "not-a-valid-url",
  incomplete: "https://github.com/test-owner",
};

/**
 * Helper to create mock axios response
 */
export function createMockAxiosResponse(data: unknown, headers = {}) {
  return {
    data,
    status: 200,
    statusText: "OK",
    headers,
    config: {},
  };
}

/**
 * Helper to calculate date for X days ago
 */
export function getDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}
