import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRepositoryAccess } from "@/lib/github/repository-access";

describe("checkRepositoryAccess", () => {
  const mockAccessToken = "github_pat_test_token_123";
  const mockFetch = vi.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Success scenarios - Valid repository access", () => {
    test("should return hasAccess=true and canPush=true with push permission", async () => {
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

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.repositoryData).toMatchObject({
        name: "test-repo",
        full_name: "test-owner/test-repo",
        private: false,
        default_branch: "main",
      });
      expect(result.repositoryData?.permissions?.push).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        {
          headers: {
            Authorization: `Bearer ${mockAccessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );
    });

    test("should return canPush=true with admin permission", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "admin-repo",
          full_name: "test-owner/admin-repo",
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

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/admin-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true); // Admin permission grants push
      expect(result.repositoryData?.permissions?.admin).toBe(true);
    });

    test("should return canPush=true with maintain permission", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "maintain-repo",
          full_name: "test-owner/maintain-repo",
          private: false,
          default_branch: "develop",
          permissions: {
            admin: false,
            maintain: true,
            push: false,
            triage: false,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/maintain-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true); // Maintain permission grants push
      expect(result.repositoryData?.permissions?.maintain).toBe(true);
    });

    test("should return canPush=false with only pull permission (read-only)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "readonly-repo",
          full_name: "test-owner/readonly-repo",
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

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/readonly-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false); // Only pull permission, no push
      expect(result.repositoryData?.permissions?.pull).toBe(true);
      expect(result.repositoryData?.permissions?.push).toBe(false);
    });
  });

  describe("URL parsing - Support for different repository URL formats", () => {
    test("should parse HTTPS repository URL format", async () => {
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

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.any(Object)
      );
    });

    test("should parse SSH repository URL format", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "ssh-repo",
          full_name: "nodejs/node",
          private: false,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "git@github.com:nodejs/node.git"
      );

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/nodejs/node",
        expect.any(Object)
      );
    });

    test("should parse repository URL with .git suffix", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "repo-with-git",
          full_name: "test-owner/repo-with-git",
          private: false,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/repo-with-git.git"
      );

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/repo-with-git",
        expect.any(Object)
      );
    });

    test("should handle repository URL without .git suffix", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "no-git-suffix",
          full_name: "octocat/Hello-World",
          private: false,
          default_branch: "master",
          permissions: { push: true, pull: true },
        }),
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/octocat/Hello-World"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.repositoryData?.full_name).toBe("octocat/Hello-World");
    });
  });

  describe("Input validation - Invalid repository URLs", () => {
    test("should return error for non-GitHub repository URL", async () => {
      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://gitlab.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("invalid_repository_url");
      expect(result.repositoryData).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return error for malformed repository URL", async () => {
      const result = await checkRepositoryAccess(
        mockAccessToken,
        "not-a-valid-url"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("invalid_repository_url");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return error for incomplete GitHub URL", async () => {
      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("invalid_repository_url");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return error for empty repository URL", async () => {
      const result = await checkRepositoryAccess(mockAccessToken, "");

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("invalid_repository_url");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("GitHub API error handling - HTTP status codes", () => {
    test("should handle 404 repository not found error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/nonexistent-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("repository_not_found_or_no_access");
      expect(result.repositoryData).toBeUndefined();
    });

    test("should handle 403 access forbidden error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/private-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("access_forbidden");
      expect(result.repositoryData).toBeUndefined();
    });

    test("should handle 401 authentication failed error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("http_error_401");
    });

    test("should handle 500 internal server error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("http_error_500");
    });

    test("should handle 502 bad gateway error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("http_error_502");
    });

    test("should handle 503 service unavailable error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("http_error_503");
    });
  });

  describe("Network error handling - Fetch exceptions", () => {
    test("should handle network error from fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("network_error");
      expect(result.repositoryData).toBeUndefined();
    });

    test("should handle timeout error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Request timeout"));

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("network_error");
    });

    test("should handle DNS resolution failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND api.github.com"));

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("network_error");
    });

    test("should handle connection refused error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("network_error");
    });
  });

  describe("Security - Authorization header validation", () => {
    test("should include Bearer token in Authorization header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "secure-repo",
          full_name: "test-owner/secure-repo",
          private: true,
          default_branch: "main",
          permissions: { push: true, pull: true },
        }),
      });

      await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/secure-repo"
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/secure-repo",
        {
          headers: {
            Authorization: `Bearer ${mockAccessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );
    });

    test("should use correct GitHub API accept header", async () => {
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

      await checkRepositoryAccess(
        mockAccessToken,
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
  });

  describe("Edge cases - Response data validation", () => {
    test("should handle response with missing permissions object", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "no-perms-repo",
          full_name: "test-owner/no-perms-repo",
          private: false,
          default_branch: "main",
          // permissions object missing
        }),
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/no-perms-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false); // Should default to false when permissions missing
      expect(result.repositoryData?.permissions).toBeUndefined();
    });

    test("should handle response with null permission values", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "null-perms-repo",
          full_name: "test-owner/null-perms-repo",
          private: false,
          default_branch: "main",
          permissions: {
            admin: null,
            maintain: null,
            push: null,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/null-perms-repo"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false); // null values should not grant push
    });

    test("should handle private repository with full permissions", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          name: "private-full-access",
          full_name: "test-owner/private-full-access",
          private: true,
          default_branch: "production",
          permissions: {
            admin: true,
            maintain: true,
            push: true,
            triage: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryAccess(
        mockAccessToken,
        "https://github.com/test-owner/private-full-access"
      );

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true);
      expect(result.repositoryData?.private).toBe(true);
      expect(result.repositoryData?.permissions?.admin).toBe(true);
    });
  });
});