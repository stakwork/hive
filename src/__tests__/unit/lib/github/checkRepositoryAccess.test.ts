import { describe, it, expect, beforeEach, vi } from "vitest";
import { checkRepositoryAccess } from "@/lib/github/checkRepositoryAccess";

// Mock global fetch
global.fetch = vi.fn();

describe("checkRepositoryAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Access Validation", () => {
    it("should return hasAccess true when user has push permission", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: true,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: true,
      });
      expect(fetch).toHaveBeenCalledWith(
        "/api/github/app/check?repositoryUrl=https%3A%2F%2Fgithub.com%2Fowner%2Frepo"
      );
    });

    it("should return hasAccess true for repository with admin permissions", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: true,
          hasAdminAccess: true,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/org/admin-repo");

      expect(result.hasAccess).toBe(true);
    });

    it("should return hasAccess true for repository with maintain permissions", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: true,
          hasMaintainAccess: true,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/org/maintain-repo");

      expect(result.hasAccess).toBe(true);
    });
  });

  describe("Access Denied Scenarios", () => {
    it("should return hasAccess false when user lacks push permission", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: false,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: false,
      });
    });

    it("should return error when repository not found", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "repository_not_found",
          hasPushAccess: false,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/nonexistent");

      expect(result).toEqual({
        hasAccess: false,
        error: "repository_not_found",
      });
    });

    it("should return error when access forbidden", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "access_forbidden",
          hasPushAccess: false,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/private/repo");

      expect(result).toEqual({
        hasAccess: false,
        error: "access_forbidden",
      });
    });
  });

  describe("Authentication and Installation Errors", () => {
    it("should return requiresReauth flag when token needs refresh", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "token_expired",
          requiresReauth: true,
          hasPushAccess: false,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: false,
        error: "token_expired",
        requiresReauth: true,
      });
    });

    it("should return requiresInstallationUpdate flag when installation access missing", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "installation_not_found",
          requiresInstallationUpdate: true,
          installationId: 12345,
          hasPushAccess: false,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/org/repo");

      expect(result).toEqual({
        hasAccess: false,
        error: "installation_not_found",
        requiresInstallationUpdate: true,
        installationId: 12345,
      });
    });

    it("should handle missing token error", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "missing_token",
          requiresReauth: true,
          hasPushAccess: false,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: false,
        error: "missing_token",
        requiresReauth: true,
      });
    });

    it("should handle revoked token error", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "token_revoked",
          requiresReauth: true,
          hasPushAccess: false,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("token_revoked");
      expect(result.requiresReauth).toBe(true);
    });
  });

  describe("Network and API Errors", () => {
    it("should handle network errors gracefully", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: false,
        error: "Failed to check repository access",
      });
    });

    it("should handle fetch timeout", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Request timeout"));

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle malformed API response", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle API server errors", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "internal_server_error",
          hasPushAccess: false,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBe("internal_server_error");
    });
  });

  describe("Repository URL Handling", () => {
    it("should handle repository URLs with .git extension", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: true,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo.git");

      expect(result.hasAccess).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("repositoryUrl=https%3A%2F%2Fgithub.com%2Fowner%2Frepo.git")
      );
    });

    it("should handle SSH-style repository URLs", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: true,
        }),
      } as Response);

      const result = await checkRepositoryAccess("git@github.com:owner/repo.git");

      expect(result.hasAccess).toBe(true);
    });

    it("should handle repository URLs with trailing slashes", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: true,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo/");

      expect(result.hasAccess).toBe(true);
    });

    it("should properly encode special characters in repository URL", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: true,
        }),
      } as Response);

      await checkRepositoryAccess("https://github.com/owner/repo-name");

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("repositoryUrl=https%3A%2F%2Fgithub.com%2Fowner%2Frepo-name")
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty repository URL", async () => {
      const result = await checkRepositoryAccess("");

      expect(result.hasAccess).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should handle undefined response from API", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
    });

    it("should handle null hasPushAccess in response", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: null,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
    });

    it("should handle response with only error field", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "unknown_error",
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toEqual({
        hasAccess: false,
        error: "unknown_error",
      });
    });
  });

  describe("Permission Boundaries", () => {
    it("should distinguish between read-only and push access", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: false,
          hasReadAccess: true,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(false);
    });

    it("should treat hasPushAccess: true as sufficient for access", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: true,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(true);
    });

    it("should handle mixed permission flags correctly", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: true,
          hasAdminAccess: false,
          hasReadAccess: true,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.hasAccess).toBe(true);
    });
  });

  describe("Response Shape Validation", () => {
    it("should return only hasAccess on success", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasPushAccess: true,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toHaveProperty("hasAccess");
      expect(Object.keys(result)).toHaveLength(1);
    });

    it("should include all error details when access denied", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "installation_missing",
          requiresInstallationUpdate: true,
          installationId: 54321,
          hasPushAccess: false,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result).toHaveProperty("hasAccess");
      expect(result).toHaveProperty("error");
      expect(result).toHaveProperty("requiresInstallationUpdate");
      expect(result).toHaveProperty("installationId");
    });

    it("should preserve installationId when provided", async () => {
      const mockInstallationId = 99999;
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: "no_access",
          installationId: mockInstallationId,
          hasPushAccess: false,
        }),
      } as Response);

      const result = await checkRepositoryAccess("https://github.com/owner/repo");

      expect(result.installationId).toBe(mockInstallationId);
    });
  });
});
