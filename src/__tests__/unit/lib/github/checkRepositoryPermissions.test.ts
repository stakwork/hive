import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRepositoryPermissions } from "@/lib/github/checkRepositoryPermissions";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("checkRepositoryPermissions", () => {
  const validAccessToken = "github_pat_test_token_123";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  describe("URL Parsing", () => {
    test("should successfully parse HTTPS repository URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
          permissions: {
            admin: false,
            push: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${validAccessToken}`,
          }),
        })
      );
    });

    test("should successfully parse SSH repository URL", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "node",
          full_name: "nodejs/node",
          private: false,
          default_branch: "main",
          permissions: {
            admin: false,
            push: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "git@github.com:nodejs/node.git"
      );

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/nodejs/node",
        expect.any(Object)
      );
    });

    test("should successfully parse repository URL with .git suffix", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
          permissions: {
            admin: false,
            push: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo.git"
      );

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.any(Object)
      );
    });

    test("should return error for invalid repository URL format", async () => {
      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://gitlab.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe("invalid_repository_url");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return error for malformed URL", async () => {
      const result = await checkRepositoryPermissions(
        validAccessToken,
        "not-a-valid-url"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("invalid_repository_url");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return error for URL missing repository name", async () => {
      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("invalid_repository_url");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Permission Calculation", () => {
    test("should calculate canPush=true with push permission", async () => {
      mockFetch.mockResolvedValueOnce({
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
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true);
      expect(result.canAdmin).toBe(false);
      expect(result.permissions).toMatchObject({
        push: true,
        admin: false,
        maintain: false,
      });
    });

    test("should calculate canPush=true with admin permission", async () => {
      mockFetch.mockResolvedValueOnce({
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
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true); // Admin grants push
      expect(result.canAdmin).toBe(true);
      expect(result.permissions).toMatchObject({
        admin: true,
        push: false, // Original push is false, but canPush is calculated as true
      });
    });

    test("should calculate canPush=true with maintain permission", async () => {
      mockFetch.mockResolvedValueOnce({
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
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true); // Maintain grants push
      expect(result.canAdmin).toBe(false);
      expect(result.permissions).toMatchObject({
        maintain: true,
        admin: false,
      });
    });

    test("should calculate canPush=false with only pull permission", async () => {
      mockFetch.mockResolvedValueOnce({
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
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false); // Only pull, no push
      expect(result.canAdmin).toBe(false);
      expect(result.permissions).toMatchObject({
        pull: true,
        push: false,
        admin: false,
      });
    });

    test("should calculate canPush=false with only triage permission", async () => {
      mockFetch.mockResolvedValueOnce({
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
            triage: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
    });

    test("should handle missing permissions object", async () => {
      mockFetch.mockResolvedValueOnce({
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
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false); // No permissions = no push
      expect(result.canAdmin).toBe(false);
      expect(result.permissions).toEqual({});
    });

    test("should handle permissions with all false values", async () => {
      mockFetch.mockResolvedValueOnce({
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
            pull: false,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
    });
  });

  describe("Repository Data Extraction", () => {
    test("should correctly extract repository metadata", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "awesome-repo",
          full_name: "octocat/awesome-repo",
          private: true,
          default_branch: "develop",
          permissions: {
            admin: true,
            push: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/octocat/awesome-repo"
      );

      expect(result.repositoryData).toEqual({
        name: "awesome-repo",
        full_name: "octocat/awesome-repo",
        private: true,
        default_branch: "develop",
      });
    });

    test("should handle repository with non-standard default branch", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "legacy-repo",
          full_name: "owner/legacy-repo",
          private: false,
          default_branch: "master",
          permissions: {
            push: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/owner/legacy-repo"
      );

      expect(result.repositoryData?.default_branch).toBe("master");
    });
  });

  describe("Error Handling - HTTP Status Codes", () => {
    test("should handle 404 repository not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/nonexistent-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe("repository_not_found_or_no_access");
      expect(result.repositoryData).toBeUndefined();
      expect(result.permissions).toBeUndefined();
    });

    test("should handle 403 access forbidden", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/private-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe("access_forbidden");
    });

    test("should handle 500 server error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe("http_error_500");
    });

    test("should handle 502 bad gateway", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.error).toBe("http_error_502");
    });

    test("should handle 503 service unavailable", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.error).toBe("http_error_503");
    });

    test("should handle 401 unauthorized", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.error).toBe("http_error_401");
    });
  });

  describe("Error Handling - Network Errors", () => {
    test("should handle network connection error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network connection failed"));

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.canAdmin).toBe(false);
      expect(result.error).toBe("network_error");
    });

    test("should handle request timeout", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.error).toBe("network_error");
    });

    test("should handle DNS resolution failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.error).toBe("network_error");
    });

    test("should handle JSON parsing error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.error).toBe("network_error");
    });
  });

  describe("GitHub API Request Format", () => {
    test("should include correct Authorization header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      await checkRepositoryPermissions(
        "custom_token_xyz",
        "https://github.com/test-owner/test-repo"
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer custom_token_xyz",
          }),
        })
      );
    });

    test("should include correct Accept header for GitHub API v3", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "application/vnd.github.v3+json",
          }),
        })
      );
    });

    test("should call correct GitHub API endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.any(Object)
      );
    });
  });

  describe("Edge Cases", () => {
    test("should handle repository with special characters in name", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo-123",
          full_name: "test-owner/test-repo-123",
          private: false,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo-123"
      );

      expect(result.hasAccess).toBe(true);
    });

    test("should handle organization with hyphen in name", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo",
          full_name: "my-org-name/repo",
          private: false,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/my-org-name/repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/my-org-name/repo",
        expect.any(Object)
      );
    });

    test("should handle empty access token gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const result = await checkRepositoryPermissions(
        "",
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("http_error_401");
    });

    test("should handle URL with trailing slash", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      // URL with trailing slash - regex should still extract correctly
      const result = await checkRepositoryPermissions(
        validAccessToken,
        "https://github.com/test-owner/test-repo/"
      );

      // The regex matches URLs with trailing slashes successfully
      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true);
      expect(result.error).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${validAccessToken}`,
          }),
        })
      );
    });

    test("should handle concurrent permission checks independently", async () => {
      // First call - success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo1",
          full_name: "owner/repo1",
          private: false,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      // Second call - failure
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const [result1, result2] = await Promise.all([
        checkRepositoryPermissions(
          validAccessToken,
          "https://github.com/owner/repo1"
        ),
        checkRepositoryPermissions(
          validAccessToken,
          "https://github.com/owner/repo2"
        ),
      ]);

      expect(result1.hasAccess).toBe(true);
      expect(result2.hasAccess).toBe(false);
      expect(result2.error).toBe("repository_not_found_or_no_access");
    });
  });

  describe("Security", () => {
    test("should not expose access token in error messages", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await checkRepositoryPermissions(
        "secret_token_123",
        "https://github.com/test-owner/test-repo"
      );

      expect(result.error).toBe("network_error");
      
      // Verify console.error was called but doesn't contain token
      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorLogMessage = consoleErrorSpy.mock.calls[0].join(" ");
      expect(errorLogMessage).not.toContain("secret_token_123");
      
      consoleErrorSpy.mockRestore();
    });

    test("should not include access token in returned error object", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      const result = await checkRepositoryPermissions(
        "secret_token_xyz",
        "https://github.com/test-owner/test-repo"
      );

      const resultString = JSON.stringify(result);
      expect(resultString).not.toContain("secret_token_xyz");
    });
  });
});