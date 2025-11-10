import { vi } from "vitest";

/**
 * Mock helpers for GitHub OAuth API responses
 * Used in GitHub App callback integration tests
 */

export interface MockTokenExchangeOptions {
  accessToken?: string;
  refreshToken?: string;
  error?: string;
  status?: number;
}

export interface MockGitHubUserOptions {
  id?: number;
  login?: string;
  name?: string;
  avatar_url?: string;
  status?: number;
}

export interface MockInstallationAccount {
  login: string;
  type: "User" | "Organization";
  avatar_url?: string;
  name?: string;
  display_name?: string;
  description?: string;
  bio?: string;
}

export interface MockInstallationsOptions {
  installations?: Array<{
    id: number;
    account: MockInstallationAccount;
  }>;
  status?: number;
}

export interface MockRepositoryOptions {
  name?: string;
  full_name?: string;
  private?: boolean;
  default_branch?: string;
  permissions?: {
    push?: boolean;
    admin?: boolean;
    pull?: boolean;
    maintain?: boolean;
  };
  status?: number;
}

/**
 * Mock a successful GitHub OAuth token exchange
 */
export function mockGitHubTokenExchange(
  mockFetch: ReturnType<typeof vi.fn>,
  options: MockTokenExchangeOptions = {}
): void {
  const {
    accessToken = "ghu_test_access_token",
    refreshToken,
    error,
    status = 200,
  } = options;

  if (error || status !== 200) {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      json: async () => ({ error }),
    });
  } else if (!accessToken && !refreshToken) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ error: "bad_verification_code" }),
    });
  } else {
    const response: Record<string, string> = { access_token: accessToken };
    if (refreshToken) {
      response.refresh_token = refreshToken;
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => response,
    });
  }
}

/**
 * Mock GitHub user API response
 */
export function mockGitHubUser(
  mockFetch: ReturnType<typeof vi.fn>,
  options: MockGitHubUserOptions = {}
): void {
  const {
    id = 12345,
    login = "test-owner",
    name = "Test Owner",
    avatar_url = `https://avatars.github.com/u/${id}`,
    status = 200,
  } = options;

  if (status !== 200) {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
    });
  } else {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id,
        login,
        name,
        avatar_url,
      }),
    });
  }
}

/**
 * Mock GitHub installations API response
 */
export function mockGitHubInstallations(
  mockFetch: ReturnType<typeof vi.fn>,
  options: MockInstallationsOptions = {}
): void {
  const { installations = [], status = 200 } = options;

  if (status !== 200) {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
    });
  } else {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ installations }),
    });
  }
}

/**
 * Mock GitHub repository API response
 */
export function mockGitHubRepository(
  mockFetch: ReturnType<typeof vi.fn>,
  options: MockRepositoryOptions = {}
): void {
  const {
    name = "test-repo",
    full_name = "test-owner/test-repo",
    private: isPrivate = false,
    default_branch = "main",
    permissions = { push: true, admin: false },
    status = 200,
  } = options;

  if (status !== 200) {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
    });
  } else {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        name,
        full_name,
        private: isPrivate,
        default_branch,
        permissions,
      }),
    });
  }
}

/**
 * Mock a complete successful GitHub App OAuth flow
 * Includes token exchange, user fetch, installations, and repository check
 */
export function mockSuccessfulGitHubAppFlow(
  mockFetch: ReturnType<typeof vi.fn>,
  options: {
    accessToken?: string;
    refreshToken?: string;
    userId?: number;
    userLogin?: string;
    installationId?: number;
    accountType?: "User" | "Organization";
    repoName?: string;
    repoFullName?: string;
    canPush?: boolean;
  } = {}
): void {
  const {
    accessToken = "ghu_test_access_token",
    refreshToken = "ghr_test_refresh_token",
    userId = 12345,
    userLogin = "test-owner",
    installationId = 98765,
    accountType = "User",
    repoName = "test-repo",
    repoFullName = `${userLogin}/${repoName}`,
    canPush = true,
  } = options;

  // Mock token exchange
  mockGitHubTokenExchange(mockFetch, { accessToken, refreshToken });

  // Mock user fetch
  mockGitHubUser(mockFetch, { id: userId, login: userLogin });

  // Mock installations
  mockGitHubInstallations(mockFetch, {
    installations: [
      {
        id: installationId,
        account: {
          login: userLogin,
          type: accountType,
          avatar_url: `https://avatars.github.com/u/${userId}`,
        },
      },
    ],
  });

  // Mock repository access
  mockGitHubRepository(mockFetch, {
    name: repoName,
    full_name: repoFullName,
    permissions: {
      push: canPush,
      admin: false,
    },
  });
}
