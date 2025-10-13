import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";

// Mock dependencies BEFORE importing the module
vi.mock("@/lib/db", () => ({
  db: {
    sourceControlToken: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(),
  },
}));

// Mock getUserAppTokens at module level BEFORE importing
vi.mock("@/lib/githubApp", async () => {
  const actual = await vi.importActual<typeof import("@/lib/githubApp")>("@/lib/githubApp");
  return {
    ...actual,
    getUserAppTokens: vi.fn(),
  };
});

import { checkRepositoryAccess, getUserAppTokens } from "@/lib/githubApp";

describe("checkRepositoryAccess unit tests", () => {
  let consoleLogs: string[] = [];
  let consoleErrors: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogs = [];
    consoleErrors = [];

    // Mock console methods to capture logs
    vi.spyOn(console, "log").mockImplementation((...args) => {
      consoleLogs.push(args.map(arg => 
        typeof arg === "object" ? JSON.stringify(arg) : String(arg)
      ).join(" "));
    });

    vi.spyOn(console, "error").mockImplementation((...args) => {
      consoleErrors.push(args.map(arg => 
        typeof arg === "object" ? JSON.stringify(arg) : String(arg)
      ).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Success scenarios", () => {
    test("should return true when repository is in installation list", async () => {
      const userId = "user-123";
      const installationId = "12345678";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_test_token_123",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 2,
          repositories: [
            { full_name: "test-owner/test-repo", private: false },
            { full_name: "test-owner/other-repo", private: true },
          ],
        }),
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(true);
      expect(getUserAppTokens).toHaveBeenCalledWith(userId, "test-owner");
      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.github.com/user/installations/${installationId}/repositories`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: "Bearer ghu_test_token_123",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      // Verify logging
      expect(consoleLogs.some(log => log.includes("ACCESS GRANTED"))).toBe(true);
    });

    test("should handle HTTPS repository URL with .git suffix", async () => {
      const userId = "user-456";
      const installationId = "87654321";
      const repositoryUrl = "https://github.com/nodejs/node.git";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_token_456",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            { full_name: "nodejs/node", private: false },
          ],
        }),
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(true);
      expect(getUserAppTokens).toHaveBeenCalledWith(userId, "nodejs");
    });

    test("should handle SSH repository URL format", async () => {
      const userId = "user-789";
      const installationId = "11111111";
      const repositoryUrl = "git@github.com:octocat/Hello-World.git";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_token_789",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            { full_name: "octocat/Hello-World", private: false },
          ],
        }),
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(true);
      expect(getUserAppTokens).toHaveBeenCalledWith(userId, "octocat");
    });

    test("should perform case-insensitive repository matching", async () => {
      const userId = "user-case";
      const installationId = "99999999";
      const repositoryUrl = "https://github.com/Test-Owner/Test-Repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_case_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            { full_name: "test-owner/test-repo", private: false }, // lowercase in API response
          ],
        }),
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(true);
      expect(consoleLogs.some(log => log.includes("test-owner/test-repo"))).toBe(true);
    });

    test("should handle repository URL without .git suffix", async () => {
      const userId = "user-no-git";
      const installationId = "22222222";
      const repositoryUrl = "git@github.com:facebook/react";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_no_git_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            { full_name: "facebook/react", private: false },
          ],
        }),
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(true);
    });
  });

  describe("Access denied scenarios", () => {
    test("should return false when repository is not in installation list", async () => {
      const userId = "user-denied";
      const installationId = "33333333";
      const repositoryUrl = "https://github.com/test-owner/private-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_denied_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 2,
          repositories: [
            { full_name: "test-owner/other-repo", private: false },
            { full_name: "different-owner/repo", private: true },
          ],
        }),
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleLogs.some(log => log.includes("ACCESS DENIED"))).toBe(true);
    });

    test("should return false when installation has empty repository list", async () => {
      const userId = "user-empty";
      const installationId = "44444444";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_empty_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 0,
          repositories: [],
        }),
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
    });

    test("should return false when repositories array is undefined", async () => {
      const userId = "user-undefined";
      const installationId = "55555555";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_undefined_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 0,
        }),
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
    });
  });

  describe("Invalid repository URL scenarios", () => {
    test("should return false for invalid GitHub repository URL", async () => {
      const userId = "user-invalid";
      const installationId = "66666666";
      const repositoryUrl = "https://gitlab.com/test-owner/test-repo";

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("Invalid GitHub repository URL"))).toBe(true);
      expect(getUserAppTokens).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should return false for malformed URL", async () => {
      const userId = "user-malformed";
      const installationId = "77777777";
      const repositoryUrl = "not-a-valid-url";

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("Invalid GitHub repository URL"))).toBe(true);
    });

    test("should return false for incomplete GitHub URL", async () => {
      const userId = "user-incomplete";
      const installationId = "88888888";
      const repositoryUrl = "https://github.com/test-owner";

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("Invalid GitHub repository URL"))).toBe(true);
    });

    test("should return false for non-GitHub domain", async () => {
      const userId = "user-bitbucket";
      const installationId = "99999999";
      const repositoryUrl = "https://bitbucket.org/test-owner/test-repo";

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("Invalid GitHub repository URL"))).toBe(true);
    });
  });

  describe("Missing token scenarios", () => {
    test("should return false when getUserAppTokens returns null", async () => {
      const userId = "user-no-tokens";
      const installationId = "10101010";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("No access token available"))).toBe(true);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should return false when getUserAppTokens returns object without accessToken", async () => {
      const userId = "user-missing-token";
      const installationId = "20202020";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        refreshToken: "refresh_token_only",
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("No access token available"))).toBe(true);
    });

    test("should return false when getUserAppTokens returns empty object", async () => {
      const userId = "user-empty-obj";
      const installationId = "30303030";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({});

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("No access token available"))).toBe(true);
    });
  });

  describe("GitHub API error scenarios", () => {
    test("should return false when GitHub API returns 404", async () => {
      const userId = "user-404";
      const installationId = "40404040";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_404_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Installation not found",
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("Failed to fetch installation repositories"))).toBe(true);
      expect(consoleErrors.some(error => error.includes("404"))).toBe(true);
    });

    test("should return false when GitHub API returns 403", async () => {
      const userId = "user-403";
      const installationId = "50505050";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_403_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "Access forbidden",
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("403"))).toBe(true);
    });

    test("should return false when GitHub API returns 500", async () => {
      const userId = "user-500";
      const installationId = "60606060";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_500_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("500"))).toBe(true);
    });

    test("should return false when GitHub API returns 401 (invalid token)", async () => {
      const userId = "user-401";
      const installationId = "70707070";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_invalid_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Bad credentials",
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("401"))).toBe(true);
    });
  });

  describe("Network error scenarios", () => {
    test("should return false when fetch throws network error", async () => {
      const userId = "user-network-error";
      const installationId = "80808080";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_network_token",
      });

      global.fetch = vi.fn().mockRejectedValue(new Error("Network error: ECONNREFUSED"));

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("Error during repository access check"))).toBe(true);
      expect(consoleErrors.some(error => error.includes("Network error"))).toBe(true);
    });

    test("should return false when fetch throws timeout error", async () => {
      const userId = "user-timeout";
      const installationId = "90909090";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_timeout_token",
      });

      global.fetch = vi.fn().mockRejectedValue(new Error("Request timeout"));

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("Error during repository access check"))).toBe(true);
    });

    test("should return false when fetch throws generic error", async () => {
      const userId = "user-generic-error";
      const installationId = "11223344";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_generic_token",
      });

      global.fetch = vi.fn().mockRejectedValue(new Error("Something went wrong"));

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("Something went wrong"))).toBe(true);
    });
  });

  describe("Logging verification", () => {
    test("should log all steps during successful access check", async () => {
      const userId = "user-logging";
      const installationId = "55667788";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_logging_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            { full_name: "test-owner/test-repo", private: false, permissions: {} },
          ],
        }),
      });

      await checkRepositoryAccess(userId, installationId, repositoryUrl);

      // Verify key logging statements
      expect(consoleLogs.some(log => log.includes("[REPO ACCESS] Starting repository access check"))).toBe(true);
      expect(consoleLogs.some(log => log.includes("[REPO ACCESS] Parsed repository"))).toBe(true);
      expect(consoleLogs.some(log => log.includes("[REPO ACCESS] Getting tokens for user"))).toBe(true);
      expect(consoleLogs.some(log => log.includes("[REPO ACCESS] Successfully retrieved access token"))).toBe(true);
      expect(consoleLogs.some(log => log.includes("[REPO ACCESS] Making GitHub API request to"))).toBe(true);
      expect(consoleLogs.some(log => log.includes("[REPO ACCESS] GitHub API response status"))).toBe(true);
      expect(consoleLogs.some(log => log.includes("[REPO ACCESS] Successfully fetched data from GitHub API"))).toBe(true);
      expect(consoleLogs.some(log => log.includes("GitHub App Installation"))).toBe(true);
      expect(consoleLogs.some(log => log.includes("Looking for repository:"))).toBe(true);
      expect(consoleLogs.some(log => log.includes("Repository access check result: GRANTED"))).toBe(true);
      expect(consoleLogs.some(log => log.includes("[REPO ACCESS] Final result: ACCESS GRANTED"))).toBe(true);
    });

    test("should log error details when token retrieval fails", async () => {
      const userId = "user-error-log";
      const installationId = "66778899";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(consoleLogs.some(log => log.includes("[REPO ACCESS] Parsed repository"))).toBe(true);
      expect(consoleLogs.some(log => log.includes("[REPO ACCESS] Getting tokens for user"))).toBe(true);
      expect(consoleErrors.some(error => error.includes("[REPO ACCESS] No access token available"))).toBe(true);
    });

    test("should log GitHub API error response body", async () => {
      const userId = "user-api-error-log";
      const installationId = "77889900";
      const repositoryUrl = "https://github.com/test-owner/test-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_api_error_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "Installation access restricted",
      });

      await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(consoleErrors.some(error => error.includes("Failed to fetch installation repositories"))).toBe(true);
      expect(consoleErrors.some(error => error.includes("Error response body"))).toBe(true);
      expect(consoleErrors.some(error => error.includes("Installation access restricted"))).toBe(true);
    });
  });

  describe("Edge cases", () => {
    test("should handle repository with special characters in name", async () => {
      const userId = "user-special-chars";
      const installationId = "88990011";
      const repositoryUrl = "https://github.com/test-owner/test-repo-123_special";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_special_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            { full_name: "test-owner/test-repo-123_special", private: false },
          ],
        }),
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(true);
    });

    test("should handle large repository list from GitHub API", async () => {
      const userId = "user-large-list";
      const installationId = "99001122";
      const repositoryUrl = "https://github.com/test-owner/needle-repo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_large_list_token",
      });

      // Create large repository list
      const repositories = Array.from({ length: 100 }, (_, i) => ({
        full_name: `test-owner/repo-${i}`,
        private: false,
      }));
      repositories.push({ full_name: "test-owner/needle-repo", private: false });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 101,
          repositories,
        }),
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(true);
    });

    test("should handle mixed case repository names correctly", async () => {
      const userId = "user-mixed-case";
      const installationId = "00112233";
      const repositoryUrl = "https://github.com/TeSt-OwNeR/TeSt-RePo";

      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "ghu_mixed_case_token",
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          total_count: 1,
          repositories: [
            { full_name: "test-owner/test-repo", private: false },
          ],
        }),
      });

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(true);
      expect(getUserAppTokens).toHaveBeenCalledWith(userId, "TeSt-OwNeR"); // Case preserved for getUserAppTokens call
    });

    test("should handle empty string parameters gracefully", async () => {
      const userId = "";
      const installationId = "";
      const repositoryUrl = "";

      const result = await checkRepositoryAccess(userId, installationId, repositoryUrl);

      expect(result).toBe(false);
      expect(consoleErrors.some(error => error.includes("Invalid GitHub repository URL"))).toBe(true);
    });
  });
});