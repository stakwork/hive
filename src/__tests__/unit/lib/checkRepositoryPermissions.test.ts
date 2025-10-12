import { describe, test, expect, beforeEach, vi } from "vitest";
import { checkRepositoryPermissions } from "@/lib/github/checkRepositoryPermissions";
import {
  mockGitHubApiResponses,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("checkRepositoryPermissions - Unit Tests", () => {
  const testAccessToken = "github_pat_test_token_123";

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("Permission Calculation Logic", () => {
    test("should calculate canPush=true and canAdmin=false with push permission only", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: true,
        canAdmin: false,
      });
      expect(result.permissions).toEqual({
        admin: false,
        maintain: false,
        push: true,
        triage: false,
        pull: true,
      });
    });

    test("should calculate canPush=true and canAdmin=true with admin permission", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.adminPermission);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: true, // Admin grants push access
        canAdmin: true,
      });
      expect(result.permissions).toEqual({
        admin: true,
        maintain: false,
        push: false,
        triage: false,
        pull: true,
      });
    });

    test("should calculate canPush=true and canAdmin=false with maintain permission", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.maintainPermission);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: true, // Maintain grants push access
        canAdmin: false,
      });
      expect(result.permissions).toEqual({
        admin: false,
        maintain: true,
        push: false,
        triage: false,
        pull: true,
      });
    });

    test("should calculate canPush=false and canAdmin=false with only pull permission", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pullOnlyPermission);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: false, // Pull-only, no push access
        canAdmin: false,
      });
      expect(result.permissions).toEqual({
        admin: false,
        maintain: false,
        push: false,
        triage: false,
        pull: true,
      });
    });

    test("should handle missing permissions object by defaulting to false", async () => {
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

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: false,
        canAdmin: false,
      });
      expect(result.permissions).toEqual({});
    });

    test("should handle permissions object with all false values", async () => {
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
            pull: false,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toMatchObject({
        hasAccess: true,
        canPush: false,
        canAdmin: false,
      });
    });
  });

  describe("URL Parsing", () => {
    test("should parse HTTPS URL format correctly", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      await checkRepositoryPermissions(
        testAccessToken,
        "https://github.com/test-owner/test-repo"
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.objectContaining({
          headers: {
            Authorization: `Bearer ${testAccessToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        })
      );
    });

    test("should parse HTTPS URL with .git suffix", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.httpsWithGit
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.any(Object)
      );
    });

    test("should parse SSH URL format correctly", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "node",
          full_name: "nodejs/node",
          private: false,
          default_branch: "main",
          permissions: { admin: false, push: true, pull: true },
        }),
      });

      await checkRepositoryPermissions(
        testAccessToken,
        "git@github.com:nodejs/node.git"
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/nodejs/node",
        expect.any(Object)
      );
    });

    test("should reject invalid GitHub URL (non-GitHub domain)", async () => {
      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.invalid
      );

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "invalid_repository_url",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should reject malformed URL", async () => {
      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.malformed
      );

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "invalid_repository_url",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should reject URL missing repository name", async () => {
      const result = await checkRepositoryPermissions(
        testAccessToken,
        "https://github.com/owner-only"
      );

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "invalid_repository_url",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should handle complex owner names with hyphens and underscores", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      await checkRepositoryPermissions(
        testAccessToken,
        "https://github.com/my-complex_owner-123/repo-name"
      );

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/my-complex_owner-123/repo-name",
        expect.any(Object)
      );
    });
  });

  describe("GitHub API Error Handling", () => {
    test("should handle 404 repository not found", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.repositoryNotFound);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "repository_not_found_or_no_access",
      });
    });

    test("should handle 403 access forbidden", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.accessForbidden);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "access_forbidden",
      });
    });

    test("should handle 500 server error", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.serverError);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "http_error_500",
      });
    });

    test("should handle 401 unauthorized", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Unauthorized",
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "http_error_401",
      });
    });

    test("should handle 503 service unavailable", async () => {
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

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "http_error_503",
      });
    });
  });

  describe("Network Error Handling", () => {
    test("should handle network connection errors", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "network_error",
      });
    });

    test("should handle fetch timeout errors", async () => {
      mockFetch.mockRejectedValue(new Error("Request timeout"));

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "network_error",
      });
    });

    test("should handle DNS resolution failures", async () => {
      mockFetch.mockRejectedValue(
        new Error("getaddrinfo ENOTFOUND api.github.com")
      );

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "network_error",
      });
    });

    test("should handle malformed JSON response from GitHub API", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token in JSON");
        },
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "network_error",
      });
    });
  });

  describe("Response Structure Validation", () => {
    test("should return complete repository data on success", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
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
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.repositoryData).toEqual({
        name: "test-repo",
        full_name: "test-owner/test-repo",
        private: true,
        default_branch: "develop",
      });
    });

    test("should not include repositoryData or permissions on error", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.repositoryNotFound);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.repositoryData).toBeUndefined();
      expect(result.permissions).toBeUndefined();
      expect(result.error).toBe("repository_not_found_or_no_access");
    });

    test("should always return hasAccess, canPush, and canAdmin booleans", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(typeof result.hasAccess).toBe("boolean");
      expect(typeof result.canPush).toBe("boolean");
      expect(typeof result.canAdmin).toBe("boolean");
    });

    test("should return error field only on failure", async () => {
      const successMock = mockGitHubApiResponses.pushPermission;
      mockFetch.mockResolvedValue(successMock);

      const successResult = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(successResult.error).toBeUndefined();

      mockFetch.mockResolvedValue(mockGitHubApiResponses.repositoryNotFound);

      const errorResult = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(errorResult.error).toBeDefined();
    });
  });

  describe("Security and Edge Cases", () => {
    test("should not expose access token in error responses", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      const resultString = JSON.stringify(result);
      expect(resultString).not.toContain(testAccessToken);
    });

    test("should handle empty access token", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      await checkRepositoryPermissions("", testRepositoryUrls.https);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            Authorization: "Bearer ",
            Accept: "application/vnd.github.v3+json",
          },
        })
      );
    });

    test("should handle empty repository URL", async () => {
      const result = await checkRepositoryPermissions(testAccessToken, "");

      expect(result).toEqual({
        hasAccess: false,
        canPush: false,
        canAdmin: false,
        error: "invalid_repository_url",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should preserve original permission values in response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          name: "test-repo",
          full_name: "test-owner/test-repo",
          private: false,
          default_branch: "main",
          permissions: {
            admin: true,
            maintain: false,
            push: false,
            triage: true,
            pull: true,
          },
        }),
      });

      const result = await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(result.permissions).toEqual({
        admin: true,
        maintain: false,
        push: false,
        triage: true,
        pull: true,
      });
    });

    test("should use correct GitHub API version header", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
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

    test("should use Bearer token authentication format", async () => {
      mockFetch.mockResolvedValue(mockGitHubApiResponses.pushPermission);

      await checkRepositoryPermissions(
        testAccessToken,
        testRepositoryUrls.https
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${testAccessToken}`,
          }),
        })
      );
    });
  });
});