import { describe, test, expect, beforeEach, vi } from "vitest";
import { checkRepositoryAccess, getUserAppTokens } from "@/lib/githubApp";
import {
  mockGitHubApiResponses,
  resetGitHubApiMocks,
  testRepositoryUrls,
  mockAccessToken,
  mockRefreshToken,
  createTestUserWithGitHubTokens,
} from "@/__tests__/support/fixtures/github-repository-permissions";

// Mock serviceConfigs to use real GitHub URL instead of mock
vi.mock("@/config/services", () => ({
  serviceConfigs: {
    github: {
      baseURL: "https://api.github.com",
      apiKey: "",
      timeout: 10000,
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    },
  },
}));

/**
 * Unit tests for installation-scoped checkRepositoryAccess function
 * 
 * This function validates that a repository remains accessible via GitHub App installation.
 * It retrieves user tokens, fetches installation repositories, and performs case-insensitive
 * matching to verify access.
 */

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    sourceControlToken: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((field: string, data: any) => {
        if (field === "source_control_token") return mockAccessToken;
        if (field === "source_control_refresh_token") return mockRefreshToken;
        return data;
      }),
    })),
  },
}));

// Import mocked modules
const { db: mockDb } = await import("@/lib/db");
const { EncryptionService } = await import("@/lib/encryption");

describe("checkRepositoryAccess (Installation-Scoped Version)", () => {
  const testUserId = "user-123";
  const testInstallationId = "12345678";

  beforeEach(() => {
    resetGitHubApiMocks();
    vi.clearAllMocks();
    // Mock global.fetch for all tests
    global.fetch = vi.fn();
  });

  describe("Token Retrieval", () => {
    test("should retrieve tokens for specific GitHub owner", async () => {
      const mockTokenData = {
        token: "encrypted-token",
        refreshToken: "encrypted-refresh",
      };

      mockDb.sourceControlToken.findFirst.mockResolvedValue(mockTokenData);

      global.fetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "test-owner/test-repo" },
        ]),
      );

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(true);
      expect(mockDb.sourceControlToken.findFirst).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          sourceControlOrg: {
            githubLogin: "test-owner",
          },
        },
        select: {
          token: true,
          refreshToken: true,
        },
      });
    });

    test("should return false when no tokens found", async () => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue(null);

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should return false when token field is null", async () => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: null,
        refreshToken: "encrypted-refresh",
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should handle decryption errors gracefully", async () => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: "encrypted-refresh",
      });

      // The vi.mock at the top of the file already mocks EncryptionService.getInstance()
      // We need to temporarily override it for this test to throw an error
      const originalMock = vi.mocked(EncryptionService.getInstance);
      const mockDecryptField = vi.fn().mockImplementation(() => {
        throw new Error("Decryption failed");
      });
      
      vi.mocked(EncryptionService.getInstance).mockReturnValueOnce({
        decryptField: mockDecryptField,
      } as any);

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
      // Note: We don't check if fetch was called because the mock might have side effects
    });
  });

  describe("URL Parsing", () => {
    test("should parse HTTPS GitHub URL", async () => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: null,
      });

      global.fetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "test-owner/test-repo" },
        ]),
      );

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        `https://api.github.com/user/installations/${testInstallationId}/repositories`,
        expect.any(Object),
      );
    });

    test("should parse SSH GitHub URL", async () => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: null,
      });

      global.fetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "nodejs/node" },
        ]),
      );

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.ssh);

      expect(result).toBe(true);
    });

    test("should return false for invalid URL: gitlab.com", async () => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: null,
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.invalid);

      expect(result).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should return false for invalid URL: empty", async () => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: null,
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, "");

      expect(result).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should return false for invalid URL: malformed", async () => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: null,
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.malformed);

      expect(result).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("GitHub Installation API", () => {
    beforeEach(() => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: null,
      });
    });

    test("should call installation repositories API with correct headers", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "test-owner/test-repo" },
        ]),
      );
      global.fetch = mockFetch;

      await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.github.com/user/installations/${testInstallationId}/repositories`,
        expect.objectContaining({
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${mockAccessToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }),
      );
    });

    test("should handle successful API response with matching repository", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "test-owner/test-repo" },
          { full_name: "test-owner/other-repo" },
        ]),
      );

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(true);
    });

    test("should return false when repository not in installation list", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "test-owner/other-repo" },
          { full_name: "different-owner/test-repo" },
        ]),
      );

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
    });

    test("should handle empty repositories list", async () => {
      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.installationRepositoriesEmpty());

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
    });

    test("should handle API error responses", async () => {
      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.installationRepositoriesError(500));

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
    });

    test("should handle 404 error for installation not found", async () => {
      global.fetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.installationRepositoriesError(404, "Not Found"));

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
    });

    test("should handle network errors", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network failure"));

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
    });
  });

  describe("Repository Matching", () => {
    beforeEach(() => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: null,
      });
    });

    test("should perform case-insensitive repository matching", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "Test-Owner/Test-Repo" }, // Different case
        ]),
      );

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(true);
    });

    test("should match exact repository name", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "test-owner/test-repo" },
        ]),
      );

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(true);
    });

    test("should not match partial repository names", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "test-owner/test" }, // Missing "-repo"
        ]),
      );

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
    });

    test("should not match owner name only", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "test-owner/different-repo" },
        ]),
      );

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
    });

    test("should handle repositories with special characters", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "test-owner/test-repo-123" },
        ]),
      );

      const result = await checkRepositoryAccess(
        testUserId,
        testInstallationId,
        "https://github.com/test-owner/test-repo-123",
      );

      expect(result).toBe(true);
    });

    test("should handle repositories list with null or undefined values", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          total_count: 0,
          repositories: null,
        }),
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    test("should handle missing installationId parameter", async () => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: null,
      });

      const mockFetch = vi.fn().mockResolvedValue(mockGitHubApiResponses.installationRepositoriesEmpty());
      global.fetch = mockFetch;

      await checkRepositoryAccess(testUserId, "", testRepositoryUrls.https);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/user/installations//repositories",
        expect.any(Object),
      );
    });

    test("should handle different installation IDs", async () => {
      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: null,
      });

      const mockFetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess([
          { full_name: "test-owner/test-repo" },
        ]),
      );
      global.fetch = mockFetch;

      const customInstallationId = "87654321";
      await checkRepositoryAccess(testUserId, customInstallationId, testRepositoryUrls.https);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.github.com/user/installations/${customInstallationId}/repositories`,
        expect.any(Object),
      );
    });

    test("should handle large repositories list", async () => {
      const largeReposList = Array.from({ length: 100 }, (_, i) => ({
        full_name: `owner/repo-${i}`,
      }));
      largeReposList.push({ full_name: "test-owner/test-repo" });

      global.fetch = vi.fn().mockResolvedValue(
        mockGitHubApiResponses.installationRepositoriesSuccess(largeReposList),
      );

      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: null,
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(true);
    });

    test("should return false when repositories array is empty", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          total_count: 0,
          repositories: [],
        }),
      });

      mockDb.sourceControlToken.findFirst.mockResolvedValue({
        token: "encrypted-token",
        refreshToken: null,
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepositoryUrls.https);

      expect(result).toBe(false);
    });
  });
});
