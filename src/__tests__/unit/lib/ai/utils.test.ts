import { describe, it, expect } from "vitest";
import { parseOwnerRepo } from "@/lib/ai/utils";

describe("ai/utils", () => {
  describe("parseOwnerRepo", () => {
    it("should parse HTTPS GitHub URL", () => {
      const result = parseOwnerRepo("https://github.com/owner/repo");

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse HTTPS GitHub URL with .git suffix", () => {
      const result = parseOwnerRepo("https://github.com/owner/repo.git");

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse SSH GitHub URL", () => {
      const result = parseOwnerRepo("git@github.com:owner/repo.git");

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse SSH GitHub URL without .git suffix", () => {
      const result = parseOwnerRepo("git@github.com:owner/repo");

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should parse shorthand format", () => {
      const result = parseOwnerRepo("owner/repo");

      expect(result).toEqual({
        owner: "owner",
        repo: "repo",
      });
    });

    it("should handle URLs with hyphens in owner", () => {
      const result = parseOwnerRepo("https://github.com/my-org/repo");

      expect(result).toEqual({
        owner: "my-org",
        repo: "repo",
      });
    });

    it("should handle URLs with hyphens in repo", () => {
      const result = parseOwnerRepo("https://github.com/owner/my-repo");

      expect(result).toEqual({
        owner: "owner",
        repo: "my-repo",
      });
    });

    it("should handle URLs with numbers", () => {
      const result = parseOwnerRepo("https://github.com/owner123/repo456");

      expect(result).toEqual({
        owner: "owner123",
        repo: "repo456",
      });
    });

    it("should handle URLs with underscores", () => {
      const result = parseOwnerRepo("https://github.com/my_org/my_repo");

      expect(result).toEqual({
        owner: "my_org",
        repo: "my_repo",
      });
    });

    it("should throw error for invalid format", () => {
      expect(() => parseOwnerRepo("invalid")).toThrow("Invalid repository URL format");
    });

    it("should throw error for empty string", () => {
      expect(() => parseOwnerRepo("")).toThrow("Invalid repository URL format");
    });

    it("should throw error for malformed URL", () => {
      expect(() => parseOwnerRepo("https://github.com/owner")).toThrow("Invalid repository URL format");
    });

    it("should throw error for non-GitHub URL", () => {
      expect(() => parseOwnerRepo("https://gitlab.com/owner/repo")).toThrow("Invalid repository URL format");
    });

    it("should throw error for URL with too many slashes", () => {
      expect(() => parseOwnerRepo("https://github.com/owner/repo/extra")).toThrow("Invalid repository URL format");
    });

    it("should handle case sensitivity correctly", () => {
      const result = parseOwnerRepo("https://github.com/MyOrg/MyRepo");

      expect(result).toEqual({
        owner: "MyOrg",
        repo: "MyRepo",
      });
    });
  });
});