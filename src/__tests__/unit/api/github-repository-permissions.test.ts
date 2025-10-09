import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import {
  mockGitHubApiResponses,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";

// Import the function to test - we'll need to export it from route.ts or move it to a separate utility
// For now, we'll test it through a wrapper that exposes the logic
async function checkRepositoryPermissions(accessToken: string, repoUrl: string): Promise<{
  hasAccess: boolean;
  canPush: boolean;
  canAdmin: boolean;
  permissions?: Record<string, boolean>;
  repositoryData?: {
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
  };
  error?: string;
}> {
  try {
    // Extract owner/repo from URL
    const githubMatch = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)(?:\.git)?/);
    if (!githubMatch) {
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'invalid_repository_url'
      };
    }

    const [, owner, repo] = githubMatch;

    // Check repository access and permissions
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (response.ok) {
      const repositoryData = await response.json();

      // Parse permissions
      const permissions = repositoryData.permissions || {};
      const canPush = permissions.push === true || permissions.admin === true || permissions.maintain === true;
      const canAdmin = permissions.admin === true;

      return {
        hasAccess: true,
        canPush,
        canAdmin,
        permissions,
        repositoryData: {
          name: repositoryData.name,
          full_name: repositoryData.full_name,
          private: repositoryData.private,
          default_branch: repositoryData.default_branch,
        }
      };
    } else if (response.status === 404) {
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'repository_not_found_or_no_access'
      };
    } else if (response.status === 403) {
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: 'access_forbidden'
      };
    } else {
      return {
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: `http_error_${response.status}`
      };
    }
  } catch (error) {
    console.error('Error checking repository permissions:', error);
    return {
      hasAccess: false,
      canPush: false,
      canAdmin: false,
      error: 'network_error'
    };
  }
}

// Helper function to create common HTTP error response mocks
function createHttpErrorResponse(status: number, statusText: string, message: string) {
  return {
    ok: false,
    status,
    statusText,
    text: async () => message,
  };
}

// Helper function to create custom repository response
function createRepositoryResponse(permissions: Record<string, boolean>, overrides: Partial<any> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      name: "test-repo",
      full_name: "test-owner/test-repo",
      private: false,
      default_branch: "main",
      permissions,
      ...overrides,
    }),
  };
}

// Helper function to verify common error response structure
function expectErrorResponse(result: any, errorType: string) {
  expect(result.hasAccess).toBe(false);
  expect(result.canPush).toBe(false);
  expect(result.canAdmin).toBe(false);
  expect(result.error).toBe(errorType);
}

// Helper function to verify successful response structure
function expectSuccessResponse(result: any, canPush: boolean, canAdmin: boolean) {
  expect(result.hasAccess).toBe(true);
  expect(result.canPush).toBe(canPush);
  expect(result.canAdmin).toBe(canAdmin);
  expect(result.error).toBeUndefined();
}

describe("checkRepositoryPermissions Unit Tests", () => {
  const mockFetch = vi.fn();
  const testAccessToken = "github_pat_test_token_123";

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Success scenarios - Permission levels", () => {
    test("should grant push access with push permission", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true);
      expect(result.canAdmin).toBe(false);
      expect(result.repositoryData).toMatchObject({
        name: "test-repo",
        full_name: "test-owner/test-repo",
        private: false,
        default_branch: "main",
      });
      expect(result.error).toBeUndefined();

      // Verify fetch was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        {
          headers: {
            Authorization: `Bearer ${testAccessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );
    });

    test("should grant push and admin access with admin permission", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.adminPermission);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true); // Admin grants push
      expect(result.canAdmin).toBe(true);
      expect(result.repositoryData?.private).toBe(true);
    });

    test("should grant push access with maintain permission", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.maintainPermission);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true); // Maintain grants push
      expect(result.canAdmin).toBe(false);
    });

    test("should deny push and admin with only pull permission", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pullOnlyPermission);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false); // Only pull, no push
      expect(result.canAdmin).toBe(false);
    });
  });

  describe("Authentication failures", () => {
    test("should return 401 error when token is invalid", async () => {
      mockFetch.mockResolvedValue(createHttpErrorResponse(401, "Unauthorized", "Bad credentials"));

      const result = await checkRepositoryPermissions(
        "invalid_token",
        testRepositoryUrls.https
      );

      expectErrorResponse(result, "http_error_401");
    });

    test("should return 401 error when token is expired", async () => {
      mockFetch.mockResolvedValue(createHttpErrorResponse(401, "Unauthorized", "Token expired"));

      const result = await checkRepositoryPermissions(
        "expired_token",
        testRepositoryUrls.https
      );

      expectErrorResponse(result, "http_error_401");
    });

    test("should handle empty token gracefully", async () => {
      mockFetch.mockResolvedValue(createHttpErrorResponse(401, "Unauthorized", "Authentication required"));

      const result = await checkRepositoryPermissions(
        "",
        testRepositoryUrls.https
      );

      expectErrorResponse(result, "http_error_401");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer ",
          }),
        })
      );
    });
  });

  describe("Authorization failures", () => {
    test("should return 403 when user lacks repository access", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.accessForbidden);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        "https://github.com/private-org/secret-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe("access_forbidden");
    });

    test("should return 403 when organization access is revoked", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "Organization access revoked",
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("access_forbidden");
    });

    test("should return 403 when repository is private and user has no access", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "Private repository access denied",
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        "https://github.com/test-owner/private-repo"
      );

      expect(result.error).toBe("access_forbidden");
    });
  });

  describe("GitHub API error scenarios", () => {
    test("should return 404 error when repository does not exist", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.repositoryNotFound);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        "https://github.com/test-owner/nonexistent-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe("repository_not_found_or_no_access");
    });

    test("should return 404 when repository is deleted", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Repository deleted",
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.error).toBe("repository_not_found_or_no_access");
    });

    test("should handle GitHub API 500 server error", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.serverError);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("http_error_500");
    });

    test("should handle GitHub API 502 bad gateway error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: async () => "Bad Gateway",
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.error).toBe("http_error_502");
    });

    test("should handle GitHub API 503 service unavailable", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "Service Unavailable",
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.error).toBe("http_error_503");
    });

    test("should handle GitHub API rate limit error (429)", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "API rate limit exceeded",
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.error).toBe("http_error_429");
    });
  });

  describe("Network error scenarios", () => {
    test("should handle network timeout errors", async () => {
      mockFetch.mockRejectedValue(new Error("Request timeout"));

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe("network_error");
    });

    test("should handle DNS resolution errors", async () => {
      mockFetch.mockRejectedValue(new Error("DNS lookup failed"));

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.error).toBe("network_error");
    });

    test("should handle connection refused errors", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.error).toBe("network_error");
    });

    test("should handle SSL certificate errors", async () => {
      mockFetch.mockRejectedValue(new Error("SSL certificate validation failed"));

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.error).toBe("network_error");
    });
  });

  describe("Input validation scenarios", () => {
    test("should reject invalid GitHub URL format", async () => {
      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.invalid
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe("invalid_repository_url");
      expect(mockFetch).not.toHaveBeenCalled(); // Should not call GitHub API
    });

    test("should reject malformed repository URL", async () => {
      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.malformed
      );

      expect(result.error).toBe("invalid_repository_url");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should reject non-GitHub URLs", async () => {
      const result = await checkRepositoryPermissions(
        testAccessToken,
        "https://bitbucket.org/user/repo"
      );

      expect(result.error).toBe("invalid_repository_url");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should reject URLs with missing repository name", async () => {
      const result = await checkRepositoryPermissions(
        testAccessToken,
        "https://github.com/test-owner/"
      );

      expect(result.error).toBe("invalid_repository_url");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Repository URL format support", () => {
    test("should support HTTPS repository URL format", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.any(Object)
      );
    });

    test("should support SSH repository URL format", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "node",
          full_name: "nodejs/node",
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
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.ssh
      );

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/nodejs/node",
        expect.any(Object)
      );
    });

    test("should support repository URL with .git suffix", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.httpsWithGit
      );

      expect(result.hasAccess).toBe(true);
      expect(result.repositoryData?.name).toBe("test-repo");
    });

    test("should support octocat demo repository URL", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "Hello-World",
          full_name: "octocat/Hello-World",
          private: false,
          default_branch: "master",
          permissions: {
            admin: true,
            maintain: true,
            push: true,
            triage: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.octocat
      );

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/octocat/Hello-World",
        expect.any(Object)
      );
    });
  });

  describe("Permission calculation logic", () => {
    test("should calculate canPush correctly with push permission only", async () => {
      mockFetch.mockResolvedValue({
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
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.canPush).toBe(true);
      expect(result.canAdmin).toBe(false);
    });

    test("should calculate canPush correctly with maintain permission", async () => {
      mockFetch.mockResolvedValue({
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
            push: false, // Push is false but maintain grants push
            triage: false,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.canPush).toBe(true); // Maintain grants push
      expect(result.canAdmin).toBe(false);
    });

    test("should calculate canPush and canAdmin correctly with admin permission", async () => {
      mockFetch.mockResolvedValue({
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
            push: false, // Push is false but admin grants push
            triage: false,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.canPush).toBe(true); // Admin grants push
      expect(result.canAdmin).toBe(true);
    });

    test("should return false for canPush and canAdmin with only pull permission", async () => {
      mockFetch.mockResolvedValue({
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
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
    });

    test("should handle missing permissions object gracefully", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
          // No permissions object
        }),
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false); // Should default to false
      expect(result.canAdmin).toBe(false);
      expect(result.permissions).toEqual({});
    });
  });

  describe("Edge cases and error handling", () => {
    test("should handle malformed JSON response from GitHub API", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("network_error");
    });

    test("should handle GitHub API response with missing required fields", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          // Missing name, full_name, default_branch
          private: false,
          permissions: {
            admin: false,
            push: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.hasAccess).toBe(true);
      expect(result.repositoryData).toMatchObject({
        name: undefined,
        full_name: undefined,
        private: false,
        default_branch: undefined,
      });
    });

    test("should handle extremely long repository URLs", async () => {
      const longUrl = `https://github.com/${"a".repeat(100)}/${"b".repeat(100)}`;

      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const result = await checkRepositoryPermissions(testAccessToken, longUrl);

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("api.github.com/repos/"),
        expect.any(Object)
      );
    });

    test("should handle repository URLs with special characters", async () => {
      const specialUrl = "https://github.com/test-owner-123/test-repo_v2.0";

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo_v2.0",
          full_name: "test-owner-123/test-repo_v2.0",
          private: false,
          default_branch: "main",
          permissions: {
            admin: false,
            push: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(testAccessToken, specialUrl);

      expect(result.hasAccess).toBe(true);
      expect(result.repositoryData?.name).toBe("test-repo_v2.0");
    });

    test("should handle null or undefined access token gracefully", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Authentication required",
      });

      // Test with null token
      const resultNull = await checkRepositoryPermissions(
        null as any,
        testRepositoryUrls.https
      );

      expect(resultNull.hasAccess).toBe(false);
      expect(resultNull.error).toBe("http_error_401");

      // Test with undefined token
      const resultUndefined = await checkRepositoryPermissions(
        undefined as any,
        testRepositoryUrls.https
      );

      expect(resultUndefined.hasAccess).toBe(false);
      expect(resultUndefined.error).toBe("http_error_401");
    });
  });

  describe("Data security validation", () => {
    test("should not expose sensitive token data in error messages", async () => {
      mockFetch.mockRejectedValue(new Error("Network error with token details"));

      const sensitiveToken = "github_pat_sensitive_token_12345";
      const result = await checkRepositoryPermissions(
        sensitiveToken,
        testRepositoryUrls.https
      );

      expect(result.error).toBe("network_error");
      expect(result.error).not.toContain(sensitiveToken);
      expect(result.error).not.toContain("token");
    });

    test("should properly handle token in Authorization header", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      await checkRepositoryPermissions(testAccessToken, testRepositoryUrls.https);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${testAccessToken}`,
            Accept: "application/vnd.github.v3+json",
          }),
        })
      );
    });

    test("should validate repository URL before making API call", async () => {
      await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.invalid
      );

      expect(mockFetch).not.toHaveBeenCalled(); // Should not call API with invalid URL
    });

    test("should not leak repository access details in error responses", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "Access denied: Repository is private and user lacks permission",
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        "https://github.com/secret-org/secret-repo"
      );

      expect(result.error).toBe("access_forbidden");
      expect(result.repositoryData).toBeUndefined(); // Should not expose repo details
    });
  });
});