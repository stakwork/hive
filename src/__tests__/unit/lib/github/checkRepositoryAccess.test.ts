import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkRepositoryAccess } from "@/lib/github/checkRepositoryAccess";

describe("checkRepositoryAccess", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Success scenarios", () => {
    it("should return hasAccess=true when API returns hasPushAccess=true", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ hasPushAccess: true }),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: true,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/github/app/check?repositoryUrl=https%3A%2F%2Fgithub.com%2Fowner%2Frepo"
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should return hasAccess=false when API returns hasPushAccess=false", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ hasPushAccess: false }),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: false,
      });
    });

    it("should handle SSH repository URLs correctly", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ hasPushAccess: true }),
      });

      const result = await checkRepositoryAccess("git@github.com:owner/repo.git");

      expect(result.hasAccess).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/github/app/check?repositoryUrl=git%40github.com%3Aowner%2Frepo.git"
      );
    });
  });

  describe("Authentication errors", () => {
    it("should return error when requiresReauth=true (expired tokens)", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          hasPushAccess: false,
          error: "GitHub App token is invalid or expired",
          requiresReauth: true,
          installationId: 12345,
        }),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: false,
        error: "GitHub App token is invalid or expired",
        requiresReauth: true,
        installationId: 12345,
      });
    });

    it("should handle missing token scenario", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          hasPushAccess: false,
          error: "No GitHub App tokens found for this repository owner",
          requiresReauth: true,
        }),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("No GitHub App tokens found for this repository owner");
      expect(result.requiresReauth).toBe(true);
    });
  });

  describe("Installation permission errors", () => {
    it("should return error when requiresInstallationUpdate=true", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          hasPushAccess: false,
          error: "Repository 'owner/repo' is not accessible through the GitHub App installation. Please ensure the repository is included in the app's permissions or reinstall the app with access to this repository.",
          requiresInstallationUpdate: true,
          installationId: 12345,
        }),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: false,
        error: "Repository 'owner/repo' is not accessible through the GitHub App installation. Please ensure the repository is included in the app's permissions or reinstall the app with access to this repository.",
        requiresInstallationUpdate: true,
        installationId: 12345,
      });
    });

    it("should handle no installation found scenario", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          hasPushAccess: false,
          error: "No GitHub App installation found for this repository owner",
        }),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("No GitHub App installation found for this repository owner");
    });
  });

  describe("Generic errors", () => {
    it("should propagate generic error messages from API", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          hasPushAccess: false,
          error: "Internal server error",
        }),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: false,
        error: "Internal server error",
        requiresReauth: undefined,
        requiresInstallationUpdate: undefined,
        installationId: undefined,
      });
    });

    it("should handle error field without additional flags", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          error: "Forbidden: Access denied",
        }),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("Forbidden: Access denied");
    });
  });

  describe("Network failures", () => {
    it("should handle fetch network errors gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("Network error: Connection refused"));

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: false,
        error: "Failed to check repository access",
      });
    });

    it("should handle fetch timeout errors", async () => {
      mockFetch.mockRejectedValue(new Error("Request timeout"));

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("Failed to check repository access");
    });

    it("should handle DNS resolution failures", async () => {
      mockFetch.mockRejectedValue(new Error("DNS lookup failed"));

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("Failed to check repository access");
    });
  });

  describe("Edge cases", () => {
    it("should handle empty repository URL", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          hasPushAccess: false,
          error: "Repository URL is required",
        }),
      });

      const result = await checkRepositoryAccess("");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("Repository URL is required");
    });

    it("should handle malformed JSON response", async () => {
      mockFetch.mockResolvedValue({
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("Failed to check repository access");
    });

    it("should handle response with missing hasPushAccess field", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({}),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
    });

    it("should handle response with null hasPushAccess", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ hasPushAccess: null }),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
    });

    it("should handle response with undefined error field", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({
          hasPushAccess: false,
          error: undefined,
        }),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBeUndefined();
    });
  });

  describe("Security and permission validation", () => {
    it("should correctly encode special characters in repository URL", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ hasPushAccess: true }),
      });

      const urlWithSpecialChars = "https://github.com/owner/repo?param=value&other=test";
      await checkRepositoryAccess(urlWithSpecialChars);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(urlWithSpecialChars))
      );
    });

    it("should treat hasPushAccess=false explicitly as no access", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ hasPushAccess: false }),
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
    });

    it("should require exact hasPushAccess=true for hasAccess=true", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ hasPushAccess: "true" }), // String instead of boolean
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      // Strict equality check: "true" !== true
      expect(result.hasAccess).toBe(false);
    });

    it("should preserve all error metadata from API response", async () => {
      const apiResponse = {
        hasPushAccess: false,
        error: "Permission denied",
        requiresReauth: true,
        requiresInstallationUpdate: false,
        installationId: 99999,
      };

      mockFetch.mockResolvedValue({
        json: async () => apiResponse,
      });

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: false,
        error: "Permission denied",
        requiresReauth: true,
        requiresInstallationUpdate: false,
        installationId: 99999,
      });
    });
  });

  describe("API endpoint verification", () => {
    it("should call correct API endpoint with encoded URL", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ hasPushAccess: true }),
      });

      const repoUrl = "https://github.com/test-owner/test-repo";
      await checkRepositoryAccess(repoUrl);

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/github/app/check?repositoryUrl=${encodeURIComponent(repoUrl)}`
      );
    });

    it("should only make one API call per invocation", async () => {
      mockFetch.mockResolvedValue({
        json: async () => ({ hasPushAccess: true }),
      });

      await checkRepositoryAccess("https://github.com/owner/repo");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});