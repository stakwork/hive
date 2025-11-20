import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { checkRepositoryAccess } from "@/lib/githubApp";
import { dbMock } from "@/__tests__/support/mocks/prisma";
import {
  mockAccessToken,
  mockRefreshToken,
  testRepositoryUrls,
} from "@/__tests__/support/fixtures/github-repository-permissions";

// Mock the fetch API globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock EncryptionService to return decrypted values
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((fieldName: string, encryptedString: string) => {
        // Parse the JSON-stringified encrypted value and return the inner value
        // In tests, we're storing tokens as JSON.stringify(actualToken)
        // So we need to parse it to get back the actual token string
        try {
          return JSON.parse(encryptedString);
        } catch {
          // If parsing fails, return as-is (for error scenarios)
          return encryptedString;
        }
      }),
    })),
  },
}));

describe("checkRepositoryAccess - Error Handling", () => {
  const testUserId = "test-user-id";
  const testInstallationId = "12345";
  const testRepoUrl = testRepositoryUrls.https;

  // Helper to create properly structured mock token response
  const createMockTokenResponse = (accessToken: string = mockAccessToken, refreshToken: string = mockRefreshToken) => ({
    token: JSON.stringify(accessToken),
    refreshToken: JSON.stringify(refreshToken),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Network and Connectivity Errors", () => {
    test("should handle network timeout gracefully", async () => {
      // Mock token retrieval success - must match the 'select' fields from getUserAppTokens
      dbMock.sourceControlToken.findFirst.mockResolvedValue(createMockTokenResponse());

      // Mock network timeout
      mockFetch.mockRejectedValue(new Error("Network timeout"));

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepoUrl);

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        "[REPO ACCESS] Error during repository access check:",
        expect.any(Error),
      );
    });

    test("should handle DNS resolution failure", async () => {
      dbMock.sourceControlToken.findFirst.mockResolvedValue(createMockTokenResponse());

      mockFetch.mockRejectedValue(new Error("ENOTFOUND: DNS lookup failed"));

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepoUrl);

      expect(result).toBe(false);
    });

    test("should handle connection refused error", async () => {
      dbMock.sourceControlToken.findFirst.mockResolvedValue(createMockTokenResponse());

      mockFetch.mockRejectedValue(new Error("ECONNREFUSED: Connection refused"));

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepoUrl);

      expect(result).toBe(false);
    });

    test("should handle SSL certificate errors", async () => {
      dbMock.sourceControlToken.findFirst.mockResolvedValue(createMockTokenResponse());

      mockFetch.mockRejectedValue(new Error("UNABLE_TO_VERIFY_LEAF_SIGNATURE"));

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepoUrl);

      expect(result).toBe(false);
    });
  });

  describe("GitHub API Error Responses", () => {
    test("should handle 401 Unauthorized (expired token)", async () => {
      dbMock.sourceControlToken.findFirst.mockResolvedValue(createMockTokenResponse());

      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => JSON.stringify({ message: "Bad credentials" }),
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepoUrl);

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        "[REPO ACCESS] Failed to fetch installation repositories:",
        401,
        "Unauthorized",
      );
    });

    test("should handle 403 Forbidden (installation access revoked)", async () => {
      dbMock.sourceControlToken.findFirst.mockResolvedValue(createMockTokenResponse());

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () =>
          JSON.stringify({
            message: "Resource not accessible by integration",
          }),
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepoUrl);

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        "[REPO ACCESS] Error response body:",
        expect.stringContaining("Resource not accessible"),
      );
    });

    test("should handle 404 Not Found (installation doesn't exist)", async () => {
      dbMock.sourceControlToken.findFirst.mockResolvedValue(createMockTokenResponse());

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => JSON.stringify({ message: "Installation not found" }),
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepoUrl);

      expect(result).toBe(false);
    });

    test("should handle 500 Internal Server Error", async () => {
      dbMock.sourceControlToken.findFirst.mockResolvedValue(createMockTokenResponse());

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Internal server error",
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepoUrl);

      expect(result).toBe(false);
    });
  });

  describe("Token-Related Error Scenarios", () => {
    test("should handle getUserAppTokens returning null", async () => {
      dbMock.sourceControlToken.findFirst.mockResolvedValue(null);

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepoUrl);

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        "[REPO ACCESS] No access token available for user:",
        testUserId,
        "and owner:",
        "test-owner", // Fixed: URL is https://github.com/test-owner/test-repo
      );
    });

    test("should handle missing accessToken in returned tokens", async () => {
      dbMock.sourceControlToken.findFirst.mockResolvedValue({
        token: null,
        refreshToken: JSON.stringify(mockRefreshToken),
      });

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepoUrl);

      expect(result).toBe(false);
    });

    test("should handle database query failure during token retrieval", async () => {
      dbMock.sourceControlToken.findFirst.mockRejectedValue(new Error("Database connection lost"));

      const result = await checkRepositoryAccess(testUserId, testInstallationId, testRepoUrl);

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith(
        "[REPO ACCESS] Error during repository access check:",
        expect.any(Error),
      );
    });
  });

  describe("URL Validation Edge Cases", () => {
    test("should handle empty repository URL", async () => {
      const result = await checkRepositoryAccess(testUserId, testInstallationId, "");

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith("[REPO ACCESS] Invalid GitHub repository URL:", "");
    });

    test("should handle whitespace-only repository URL", async () => {
      const result = await checkRepositoryAccess(testUserId, testInstallationId, "   ");

      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalledWith("[REPO ACCESS] Invalid GitHub repository URL:", "   ");
    });

    test("should handle URL with query parameters", async () => {
      const urlWithParams = "https://github.com/owner/repo?tab=readme";
      
      // The URL is actually parsed correctly (query params are ignored by regex)
      // So it will fail at token retrieval instead of URL validation
      dbMock.sourceControlToken.findFirst.mockResolvedValue(null);

      const result = await checkRepositoryAccess(testUserId, testInstallationId, urlWithParams);

      expect(result).toBe(false);
      // It fails at token retrieval, not URL validation
      expect(console.error).toHaveBeenCalledWith(
        "[REPO ACCESS] No access token available for user:",
        testUserId,
        "and owner:",
        "owner",
      );
    });

    test("should handle URL with fragment identifier", async () => {
      const urlWithFragment = "https://github.com/owner/repo#readme";

      const result = await checkRepositoryAccess(testUserId, testInstallationId, urlWithFragment);

      expect(result).toBe(false);
    });
  });
});
