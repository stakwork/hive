import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/db");
vi.mock("@/lib/env");
vi.mock("@/lib/encryption");

// Hoisted mock - must use vi.hoisted to avoid initialization errors
const { mockGetUserAppTokens } = vi.hoisted(() => ({
  mockGetUserAppTokens: vi.fn(),
}));

// Mock githubApp module to replace getUserAppTokens
vi.mock("@/lib/githubApp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/githubApp")>();
  return {
    ...actual,
    getUserAppTokens: mockGetUserAppTokens,
  };
});

// Import after mocking
import { checkRepositoryAccess } from "@/lib/githubApp";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("checkRepositoryAccess - Unit Tests", () => {
  const TEST_USER_ID = "test-user-123";
  const TEST_INSTALLATION_ID = "123456789";
  const TEST_ACCESS_TOKEN = "gho_test_token_abc123";

  beforeEach(() => {
    // Clear all previous mock calls and implementations
    mockFetch.mockClear();
    mockGetUserAppTokens.mockClear();
    
    // Suppress console logs
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Valid repository access scenarios", () => {
    test("should return true when repository exists in installation list", async () => {
      // Arrange
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [
            { full_name: "test-owner/test-repo" },
            { full_name: "test-owner/other-repo" },
          ],
        }),
      });

      // Act
      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      // Assert
      expect(result).toBe(true);
      expect(mockGetUserAppTokens).toHaveBeenCalledWith(TEST_USER_ID, "test-owner");
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.github.com/user/installations/${TEST_INSTALLATION_ID}/repositories`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${TEST_ACCESS_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          }),
        })
      );
    });

    test("should handle HTTPS repository URL with .git suffix", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo.git";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [{ full_name: "test-owner/test-repo" }],
        }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(true);
    });

    test("should handle SSH repository URL format", async () => {
      const repositoryUrl = "git@github.com:nodejs/node.git";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [{ full_name: "nodejs/node" }],
        }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(true);
      expect(mockGetUserAppTokens).toHaveBeenCalledWith(TEST_USER_ID, "nodejs");
    });

    test("should perform case-insensitive repository name matching", async () => {
      const repositoryUrl = "https://github.com/Test-Owner/Test-Repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [
            { full_name: "test-owner/test-repo" }, // Lowercase in API response
          ],
        }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(true);
    });

    test("should handle repository URL without .git suffix", async () => {
      const repositoryUrl = "https://github.com/octocat/Hello-World";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [{ full_name: "octocat/Hello-World" }],
        }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(true);
      expect(mockGetUserAppTokens).toHaveBeenCalledWith(TEST_USER_ID, "octocat");
    });
  });

  describe("Invalid repository URL scenarios", () => {
    test("should return false for non-GitHub URL", async () => {
      const repositoryUrl = "https://gitlab.com/test-owner/test-repo";

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
      expect(mockGetUserAppTokens).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return false for malformed repository URL", async () => {
      const repositoryUrl = "not-a-valid-url";

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
      expect(mockGetUserAppTokens).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return false for incomplete GitHub URL", async () => {
      const repositoryUrl = "https://github.com/test-owner";

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
      expect(mockGetUserAppTokens).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return false for empty repository URL", async () => {
      const repositoryUrl = "";

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
      expect(mockGetUserAppTokens).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Authentication and token scenarios", () => {
    test("should return false when getUserAppTokens returns null", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue(null);

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
      expect(mockGetUserAppTokens).toHaveBeenCalledWith(TEST_USER_ID, "test-owner");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return false when access token is missing", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        refreshToken: "some-refresh-token",
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return false when getUserAppTokens returns empty object", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({});

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Repository access validation scenarios", () => {
    test("should return false when repository not in installation list", async () => {
      const repositoryUrl = "https://github.com/test-owner/private-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [
            { full_name: "test-owner/other-repo" },
            { full_name: "test-owner/another-repo" },
          ],
        }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.github.com/user/installations/${TEST_INSTALLATION_ID}/repositories`,
        expect.any(Object)
      );
    });

    test("should return false when repositories array is empty", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [],
        }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
    });

    test("should return false when repositories field is missing", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
    });

    test("should match exact repository from multiple repositories", async () => {
      const repositoryUrl = "https://github.com/test-owner/target-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [
            { full_name: "test-owner/repo-one" },
            { full_name: "test-owner/target-repo" },
            { full_name: "test-owner/repo-three" },
          ],
        }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(true);
    });
  });

  describe("GitHub API error scenarios", () => {
    test("should return false when GitHub API returns 404", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Not Found",
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
    });

    test("should return false when GitHub API returns 403 Forbidden", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "Forbidden",
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
    });

    test("should return false when GitHub API returns 401 Unauthorized", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "Unauthorized",
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
    });

    test("should return false when GitHub API returns 500 Internal Server Error", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Internal Server Error",
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
    });

    test("should return false when GitHub API returns 503 Service Unavailable", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: async () => "Service Unavailable",
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
    });
  });

  describe("Network and exception error scenarios", () => {
    test("should return false when network request throws error", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        "[REPO ACCESS] Error during repository access check:",
        expect.any(Error)
      );
    });

    test("should return false when GitHub API fetch timeout", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockRejectedValue(new Error("Request timeout"));

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
    });

    test("should return false when JSON parsing fails", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
    });

    test("should return false when getUserAppTokens throws error", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockRejectedValue(
        new Error("Database connection failed")
      );

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Edge cases and boundary conditions", () => {
    test("should handle repository URL with special characters", async () => {
      const repositoryUrl = "https://github.com/test-owner/repo-with-dashes_and_underscores";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [
            { full_name: "test-owner/repo-with-dashes_and_underscores" },
          ],
        }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(true);
    });

    test("should handle repository URL with numeric characters", async () => {
      const repositoryUrl = "https://github.com/test123/repo456";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [{ full_name: "test123/repo456" }],
        }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(true);
      expect(mockGetUserAppTokens).toHaveBeenCalledWith(TEST_USER_ID, "test123");
    });

    test("should handle very long repository names", async () => {
      const longRepoName = "a".repeat(100);
      const repositoryUrl = `https://github.com/test-owner/${longRepoName}`;
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [{ full_name: `test-owner/${longRepoName}` }],
        }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(true);
    });

    test("should handle installation with many repositories", async () => {
      const repositoryUrl = "https://github.com/test-owner/target-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      // Create 100 repositories with target repo in the middle
      const repositories = Array.from({ length: 100 }, (_, i) => ({
        full_name: `test-owner/repo-${i}`,
      }));
      repositories[50] = { full_name: "test-owner/target-repo" };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ repositories }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(result).toBe(true);
    });

    test("should handle different GitHub owner types (user vs org)", async () => {
      const orgRepoUrl = "https://github.com/my-organization/org-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [{ full_name: "my-organization/org-repo" }],
        }),
      });

      const result = await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        orgRepoUrl
      );

      expect(result).toBe(true);
      expect(mockGetUserAppTokens).toHaveBeenCalledWith(TEST_USER_ID, "my-organization");
    });
  });

  describe("Console logging verification", () => {
    test("should log access check details for valid access", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          repositories: [{ full_name: "test-owner/test-repo" }],
        }),
      });

      await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(console.log).toHaveBeenCalledWith(
        "[REPO ACCESS] Starting repository access check:",
        expect.objectContaining({
          userId: TEST_USER_ID,
          installationId: TEST_INSTALLATION_ID,
          repositoryUrl,
        })
      );
      expect(console.log).toHaveBeenCalledWith(
        "[REPO ACCESS] Final result:",
        "ACCESS GRANTED"
      );
    });

    test("should log error for invalid URL", async () => {
      const repositoryUrl = "invalid-url";

      await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(console.error).toHaveBeenCalledWith(
        "[REPO ACCESS] Invalid GitHub repository URL:",
        repositoryUrl
      );
    });

    test("should log error when no access token available", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue(null);

      await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(console.error).toHaveBeenCalledWith(
        "[REPO ACCESS] No access token available for user:",
        TEST_USER_ID,
        "and owner:",
        "test-owner"
      );
    });

    test("should log error for GitHub API failures", async () => {
      const repositoryUrl = "https://github.com/test-owner/test-repo";
      
      mockGetUserAppTokens.mockResolvedValue({
        accessToken: TEST_ACCESS_TOKEN,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "Forbidden",
      });

      await checkRepositoryAccess(
        TEST_USER_ID,
        TEST_INSTALLATION_ID,
        repositoryUrl
      );

      expect(console.error).toHaveBeenCalledWith(
        "[REPO ACCESS] Failed to fetch installation repositories:",
        403,
        "Forbidden"
      );
    });
  });
});
