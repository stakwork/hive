import { describe, test, expect, beforeEach, vi } from "vitest";

/**
 * Unit Tests for checkRepositoryPermissions Function
 * 
 * Tests the core permission checking logic in isolation, focusing on:
 * 1. Permission matrix accuracy (all 16 combinations)
 * 2. Error handling (404/403/500/network errors)
 * 3. URL parsing edge cases
 * 4. Response structure validation
 */

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Extract function under test (inline for unit testing)
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
    // Strict regex: must start with https:// or git@, no trailing slash, no query params
    const githubMatch = repoUrl.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^\/]+)\/([^\/\.\?#]+?)(?:\.git)?$/);
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

// Test data: Permission matrix combinations
const permissionMatrixTestCases = [
  // All permissions false
  {
    permissions: { push: false, admin: false, maintain: false, pull: false },
    expected: { canPush: false, canAdmin: false },
    description: "no permissions"
  },
  // Only pull permission
  {
    permissions: { push: false, admin: false, maintain: false, pull: true },
    expected: { canPush: false, canAdmin: false },
    description: "pull only"
  },
  // Push permission
  {
    permissions: { push: true, admin: false, maintain: false, pull: true },
    expected: { canPush: true, canAdmin: false },
    description: "push permission"
  },
  // Maintain permission
  {
    permissions: { push: false, admin: false, maintain: true, pull: true },
    expected: { canPush: true, canAdmin: false },
    description: "maintain permission"
  },
  // Admin permission
  {
    permissions: { push: false, admin: true, maintain: false, pull: true },
    expected: { canPush: true, canAdmin: true },
    description: "admin permission"
  },
  // Admin + push
  {
    permissions: { push: true, admin: true, maintain: false, pull: true },
    expected: { canPush: true, canAdmin: true },
    description: "admin + push"
  },
  // Admin + maintain
  {
    permissions: { push: false, admin: true, maintain: true, pull: true },
    expected: { canPush: true, canAdmin: true },
    description: "admin + maintain"
  },
  // Push + maintain
  {
    permissions: { push: true, admin: false, maintain: true, pull: true },
    expected: { canPush: true, canAdmin: false },
    description: "push + maintain"
  },
  // All permissions true
  {
    permissions: { push: true, admin: true, maintain: true, pull: true },
    expected: { canPush: true, canAdmin: true },
    description: "all permissions"
  },
  // Triage permission (not affecting canPush)
  {
    permissions: { push: false, admin: false, maintain: false, pull: true, triage: true },
    expected: { canPush: false, canAdmin: false },
    description: "triage only"
  },
  // Edge case: Only maintain and pull
  {
    permissions: { maintain: true, pull: true },
    expected: { canPush: true, canAdmin: false },
    description: "maintain without explicit push/admin"
  },
  // Edge case: Only admin
  {
    permissions: { admin: true },
    expected: { canPush: true, canAdmin: true },
    description: "admin only without other permissions"
  },
  // Edge case: Empty permissions object
  {
    permissions: {},
    expected: { canPush: false, canAdmin: false },
    description: "empty permissions object"
  },
  // Edge case: Push explicitly false with admin true
  {
    permissions: { push: false, admin: true, maintain: false },
    expected: { canPush: true, canAdmin: true },
    description: "admin overrides explicit push:false"
  },
  // Edge case: Maintain explicitly false with push true
  {
    permissions: { push: true, admin: false, maintain: false },
    expected: { canPush: true, canAdmin: false },
    description: "push with explicit maintain:false"
  },
  // Edge case: All explicitly false
  {
    permissions: { push: false, admin: false, maintain: false, pull: false, triage: false },
    expected: { canPush: false, canAdmin: false },
    description: "all permissions explicitly false"
  }
];

// Test data: URL formats
const urlTestCases = [
  {
    url: "https://github.com/owner/repo",
    valid: true,
    owner: "owner",
    repo: "repo",
    description: "HTTPS format"
  },
  {
    url: "https://github.com/owner/repo.git",
    valid: true,
    owner: "owner",
    repo: "repo",
    description: "HTTPS with .git suffix"
  },
  {
    url: "git@github.com:owner/repo.git",
    valid: true,
    owner: "owner",
    repo: "repo",
    description: "SSH format"
  },
  {
    url: "git@github.com:owner/repo",
    valid: true,
    owner: "owner",
    repo: "repo",
    description: "SSH without .git"
  },
  {
    url: "https://github.com/org-name/repo-name",
    valid: true,
    owner: "org-name",
    repo: "repo-name",
    description: "hyphenated names"
  },
  {
    url: "https://github.com/owner/repo-with-many-hyphens-123",
    valid: true,
    owner: "owner",
    repo: "repo-with-many-hyphens-123",
    description: "complex repo name"
  },
  {
    url: "invalid-url",
    valid: false,
    description: "invalid URL format"
  },
  {
    url: "https://gitlab.com/owner/repo",
    valid: false,
    description: "wrong domain (gitlab)"
  },
  {
    url: "https://github.com/owner",
    valid: false,
    description: "missing repo name"
  },
  {
    url: "https://github.com/",
    valid: false,
    description: "missing owner and repo"
  },
  {
    url: "",
    valid: false,
    description: "empty string"
  },
  {
    url: "github.com/owner/repo",
    valid: false,
    description: "missing protocol"
  }
];

describe("checkRepositoryPermissions - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("Permission Matrix Validation", () => {
    test.each(permissionMatrixTestCases)(
      "should calculate permissions correctly for $description",
      async ({ permissions, expected }) => {
        // Arrange
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            name: "test-repo",
            full_name: "test-owner/test-repo",
            private: false,
            default_branch: "main",
            permissions
          })
        });

        // Act
        const result = await checkRepositoryPermissions(
          "test-token",
          "https://github.com/test-owner/test-repo"
        );

        // Assert
        expect(result.hasAccess).toBe(true);
        expect(result.canPush).toBe(expected.canPush);
        expect(result.canAdmin).toBe(expected.canAdmin);
        expect(result.permissions).toEqual(permissions);
      }
    );

    test("should preserve all permission fields in response", async () => {
      const permissions = {
        admin: true,
        maintain: true,
        push: true,
        triage: true,
        pull: true
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
          permissions
        })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/test-owner/test-repo"
      );

      expect(result.permissions).toEqual(permissions);
      expect(Object.keys(result.permissions!)).toHaveLength(5);
    });
  });

  describe("URL Parsing", () => {
    test.each(urlTestCases.filter(tc => tc.valid))(
      "should parse $description correctly",
      async ({ url, owner, repo }) => {
        // Arrange
        mockFetch.mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            name: repo,
            full_name: `${owner}/${repo}`,
            private: false,
            default_branch: "main",
            permissions: { push: true }
          })
        });

        // Act
        const result = await checkRepositoryPermissions("test-token", url);

        // Assert
        expect(result.hasAccess).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith(
          `https://api.github.com/repos/${owner}/${repo}`,
          expect.objectContaining({
            headers: expect.objectContaining({
              'Authorization': 'Bearer test-token',
              'Accept': 'application/vnd.github.v3+json'
            })
          })
        );
      }
    );

    test.each(urlTestCases.filter(tc => !tc.valid))(
      "should reject $description",
      async ({ url }) => {
        // Act
        const result = await checkRepositoryPermissions("test-token", url);

        // Assert
        expect(result.hasAccess).toBe(false);
        expect(result.canPush).toBe(false);
        expect(result.canAdmin).toBe(false);
        expect(result.error).toBe('invalid_repository_url');
        expect(mockFetch).not.toHaveBeenCalled();
      }
    );

    test("should handle URL with trailing slash", async () => {
      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo/"
      );

      expect(result.error).toBe('invalid_repository_url');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should handle URL with query parameters", async () => {
      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo?param=value"
      );

      expect(result.error).toBe('invalid_repository_url');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("GitHub API Error Handling", () => {
    test("should handle 404 repository not found", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ message: "Not Found" })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/test-owner/nonexistent-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe('repository_not_found_or_no_access');
    });

    test("should handle 403 access forbidden", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ message: "Forbidden" })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/test-owner/private-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe('access_forbidden');
    });

    test("should handle 500 server error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: "Internal Server Error" })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe('http_error_500');
    });

    test("should handle 401 unauthorized", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: "Unauthorized" })
      });

      const result = await checkRepositoryPermissions(
        "invalid-token",
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe('http_error_401');
    });

    test("should handle 429 rate limiting", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ message: "API rate limit exceeded" })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe('http_error_429');
    });

    test("should handle network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network request failed"));

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe('network_error');
    });

    test("should handle fetch timeout", async () => {
      mockFetch.mockRejectedValue(new Error("Request timeout"));

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/test-owner/test-repo"
      );

      expect(result.error).toBe('network_error');
    });

    test("should handle DNS resolution failure", async () => {
      mockFetch.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/test-owner/test-repo"
      );

      expect(result.error).toBe('network_error');
    });
  });

  describe("Response Structure Validation", () => {
    test("should return complete repository data on success", async () => {
      const mockRepoData = {
        name: "test-repo",
        full_name: "test-owner/test-repo",
        private: true,
        default_branch: "develop",
        permissions: { push: true, admin: false }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockRepoData
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/test-owner/test-repo"
      );

      expect(result.repositoryData).toEqual({
        name: "test-repo",
        full_name: "test-owner/test-repo",
        private: true,
        default_branch: "develop"
      });
    });

    test("should handle private repository flag correctly", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "private-repo",
          full_name: "owner/private-repo",
          private: true,
          default_branch: "main",
          permissions: { push: true }
        })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/private-repo"
      );

      expect(result.repositoryData?.private).toBe(true);
    });

    test("should handle non-standard default branch", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo",
          full_name: "owner/repo",
          private: false,
          default_branch: "master",
          permissions: { push: true }
        })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo"
      );

      expect(result.repositoryData?.default_branch).toBe("master");
    });

    test("should not include repositoryData on error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo"
      );

      expect(result.repositoryData).toBeUndefined();
    });
  });

  describe("Edge Cases", () => {
    test("should handle missing permissions object", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo",
          full_name: "owner/repo",
          private: false,
          default_branch: "main"
          // permissions object missing
        })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.permissions).toEqual({});
    });

    test("should handle null permissions", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo",
          full_name: "owner/repo",
          private: false,
          default_branch: "main",
          permissions: null
        })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
    });

    test("should handle permissions with undefined values", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo",
          full_name: "owner/repo",
          private: false,
          default_branch: "main",
          permissions: {
            push: undefined,
            admin: undefined,
            maintain: undefined
          }
        })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo"
      );

      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
    });

    test("should handle malformed JSON response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token in JSON");
        }
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe('network_error');
    });

    test("should handle empty access token", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401
      });

      const result = await checkRepositoryPermissions(
        "",
        "https://github.com/owner/repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe('http_error_401');
    });

    test("should handle very long repository names", async () => {
      const longRepoName = "a".repeat(100);
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: longRepoName,
          full_name: `owner/${longRepoName}`,
          private: false,
          default_branch: "main",
          permissions: { push: true }
        })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        `https://github.com/owner/${longRepoName}`
      );

      expect(result.hasAccess).toBe(true);
      expect(result.repositoryData?.name).toBe(longRepoName);
    });

    test("should handle repository names with special characters", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo-name_123",
          full_name: "owner/repo-name_123",
          private: false,
          default_branch: "main",
          permissions: { push: true }
        })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo-name_123"
      );

      expect(result.hasAccess).toBe(true);
    });

    test("should call GitHub API with correct authorization header", async () => {
      const token = "test-token-xyz-123";
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo",
          full_name: "owner/repo",
          private: false,
          default_branch: "main",
          permissions: { push: true }
        })
      });

      await checkRepositoryPermissions(token, "https://github.com/owner/repo");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/owner/repo",
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );
    });

    test("should make exactly one API call per check", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo",
          full_name: "owner/repo",
          private: false,
          default_branch: "main",
          permissions: { push: true }
        })
      });

      await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo"
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("should not make API call for invalid URL", async () => {
      await checkRepositoryPermissions("test-token", "invalid-url");

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Permission Precedence", () => {
    test("admin permission should grant push access even if push is false", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo",
          full_name: "owner/repo",
          private: false,
          default_branch: "main",
          permissions: {
            push: false,
            admin: true,
            maintain: false
          }
        })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo"
      );

      expect(result.canPush).toBe(true);
      expect(result.canAdmin).toBe(true);
    });

    test("maintain permission should grant push access even if push is false", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo",
          full_name: "owner/repo",
          private: false,
          default_branch: "main",
          permissions: {
            push: false,
            admin: false,
            maintain: true
          }
        })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo"
      );

      expect(result.canPush).toBe(true);
      expect(result.canAdmin).toBe(false);
    });

    test("admin should be only permission that grants canAdmin", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo",
          full_name: "owner/repo",
          private: false,
          default_branch: "main",
          permissions: {
            push: true,
            admin: false,
            maintain: true
          }
        })
      });

      const result = await checkRepositoryPermissions(
        "test-token",
        "https://github.com/owner/repo"
      );

      expect(result.canPush).toBe(true);
      expect(result.canAdmin).toBe(false);
    });
  });
});
