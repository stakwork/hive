import { describe, test, expect, beforeEach, vi } from "vitest";
import { checkRepositoryAccess } from "@/lib/github-oauth-repository-access";
import {
  mockGitHubRepository,
  mockGitHubApiResponses,
  resetGitHubApiMocks,
  testRepositoryUrls,
  mockAccessToken,
} from "@/__tests__/support/fixtures/github-repository-permissions";

/**
 * Unit tests for OAuth callback checkRepositoryAccess function
 *
 * This function validates repository access immediately after OAuth authorization.
 * It extracts owner/repo from GitHub URLs, checks repository access via GitHub API,
 * and evaluates push permissions.
 */

describe("checkRepositoryAccess (OAuth Callback Version)", () => {
  beforeEach(() => {
    resetGitHubApiMocks();
    // Mock global.fetch for all tests
    global.fetch = vi.fn();
  });

  describe("URL Parsing", () => {
    test("should parse HTTPS GitHub URL", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(mockGitHubApiResponses.repositorySuccess(mockGitHubRepository.withPushPermissions()));
      global.fetch = mockFetch;

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockAccessToken}`,
            Accept: "application/vnd.github.v3+json",
          }),
        }),
      );
    });

    test("should parse HTTPS GitHub URL with .git extension", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(mockGitHubApiResponses.repositorySuccess(mockGitHubRepository.withPushPermissions()));
      global.fetch = mockFetch;

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.httpsWithGit);

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith("https://api.github.com/repos/test-owner/test-repo", expect.any(Object));
    });

    test("should parse SSH GitHub URL", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(mockGitHubApiResponses.repositorySuccess(mockGitHubRepository.withPushPermissions()));
      global.fetch = mockFetch;

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.ssh);

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith("https://api.github.com/repos/nodejs/node", expect.any(Object));
    });

    test("should reject invalid URL: gitlab.com", async () => {
      const result = await checkRepositoryAccess(mockAccessToken, "https://gitlab.com/test-owner/test-repo");

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("invalid_repository_url");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should reject invalid URL: empty string", async () => {
      const result = await checkRepositoryAccess(mockAccessToken, "");

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("invalid_repository_url");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should reject invalid URL: malformed", async () => {
      const result = await checkRepositoryAccess(mockAccessToken, "not-a-valid-url");

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("invalid_repository_url");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should handle URLs with special characters in repo name", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.repositorySuccess(
          mockGitHubRepository.withPushPermissions({
            name: "test-repo-123",
            full_name: "test-owner/test-repo-123",
          }),
        ),
      );
      global.fetch = mockFetch;

      const result = await checkRepositoryAccess(mockAccessToken, "https://github.com/test-owner/test-repo-123");

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/test-owner/test-repo-123",
        expect.any(Object),
      );
    });
  });

  describe("GitHub API Response Handling", () => {
    test("should handle successful repository access (200 OK)", async () => {
      const mockRepo = mockGitHubRepository.withPushPermissions({
        name: "my-repo",
        full_name: "owner/my-repo",
        private: true,
        default_branch: "develop",
      });

      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.repositorySuccess(mockRepo));

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.repositoryData).toEqual({
        name: "my-repo",
        full_name: "owner/my-repo",
        private: true,
        default_branch: "develop",
        permissions: mockRepo.permissions,
      });
    });

    test("should handle repository not found (404)", async () => {
      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.repositoryNotFound());

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("repository_not_found_or_no_access");
      expect(result.repositoryData).toBeUndefined();
    });

    test("should handle access forbidden (403)", async () => {
      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.repositoryForbidden());

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("access_forbidden");
      expect(result.repositoryData).toBeUndefined();
    });

    test("should handle server error (500)", async () => {
      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.repositoryServerError());

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("http_error_500");
      expect(result.repositoryData).toBeUndefined();
    });

    test("should handle network errors", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("network_error");
      expect(result.repositoryData).toBeUndefined();
    });

    test("should handle other HTTP error codes", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
      } as Response);

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(false);
      expect(result.canPush).toBe(false);
      expect(result.error).toBe("http_error_502");
    });
  });

  describe("Permission Evaluation", () => {
    test("should grant push access when user has push permission", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(mockGitHubApiResponses.repositorySuccess(mockGitHubRepository.withPushPermissions()));

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true);
      expect(result.repositoryData?.permissions?.push).toBe(true);
    });

    test("should grant push access when user has admin permission", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(mockGitHubApiResponses.repositorySuccess(mockGitHubRepository.withFullPermissions()));

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true);
      expect(result.repositoryData?.permissions?.admin).toBe(true);
    });

    test("should grant push access when user has maintain permission", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(mockGitHubApiResponses.repositorySuccess(mockGitHubRepository.withMaintainPermissions()));

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(true);
      expect(result.repositoryData?.permissions?.maintain).toBe(true);
    });

    test("should deny push access when user has only read permission", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValue(mockGitHubApiResponses.repositorySuccess(mockGitHubRepository.withReadOnlyPermissions()));

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false);
      expect(result.repositoryData?.permissions?.push).toBe(false);
      expect(result.repositoryData?.permissions?.admin).toBe(false);
      expect(result.repositoryData?.permissions?.maintain).toBe(false);
    });

    test("should handle missing permissions object", async () => {
      const repoWithoutPermissions = mockGitHubRepository.withPushPermissions();
      delete repoWithoutPermissions.permissions;

      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.repositorySuccess(repoWithoutPermissions));

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false);
      expect(result.repositoryData?.permissions).toBeUndefined();
    });

    test("should handle permissions with undefined values", async () => {
      const repoWithUndefinedPermissions = mockGitHubRepository.withPushPermissions({
        permissions: {
          push: undefined,
          admin: undefined,
          maintain: undefined,
        },
      });

      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.repositorySuccess(repoWithUndefinedPermissions));

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(true);
      expect(result.canPush).toBe(false);
    });
  });

  describe("Authorization Header", () => {
    test("should send correct authorization header", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(mockGitHubApiResponses.repositorySuccess(mockGitHubRepository.withPushPermissions()));
      global.fetch = mockFetch;

      await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockAccessToken}`,
          }),
        }),
      );
    });

    test("should send correct Accept header", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(mockGitHubApiResponses.repositorySuccess(mockGitHubRepository.withPushPermissions()));
      global.fetch = mockFetch;

      await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: "application/vnd.github.v3+json",
          }),
        }),
      );
    });

    test("should work with different access tokens", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(mockGitHubApiResponses.repositorySuccess(mockGitHubRepository.withPushPermissions()));
      global.fetch = mockFetch;

      const customToken = "gho_custom_token_98765";
      await checkRepositoryAccess(customToken, testRepositoryUrls.https);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${customToken}`,
          }),
        }),
      );
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty access token", async () => {
      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.repositoryForbidden());

      const result = await checkRepositoryAccess("", testRepositoryUrls.https);

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("access_forbidden");
    });

    test("should handle repository with no default branch", async () => {
      const repoWithoutDefaultBranch = mockGitHubRepository.withPushPermissions();
      delete (repoWithoutDefaultBranch as any).default_branch;

      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.repositorySuccess(repoWithoutDefaultBranch));

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(true);
      expect(result.repositoryData?.default_branch).toBeUndefined();
    });

    test("should handle private repository correctly", async () => {
      const privateRepo = mockGitHubRepository.withPushPermissions({ private: true });

      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.repositorySuccess(privateRepo));

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(true);
      expect(result.repositoryData?.private).toBe(true);
    });

    test("should handle public repository correctly", async () => {
      const publicRepo = mockGitHubRepository.withPushPermissions({ private: false });

      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.repositorySuccess(publicRepo));

      const result = await checkRepositoryAccess(mockAccessToken, testRepositoryUrls.https);

      expect(result.hasAccess).toBe(true);
      expect(result.repositoryData?.private).toBe(false);
    });
  });
});
