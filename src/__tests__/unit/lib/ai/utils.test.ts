import { describe, test, expect } from "vitest";
import { parseOwnerRepo } from "@/lib/ai/utils";

describe("parseOwnerRepo", () => {
  describe("HTTPS GitHub URL formats", () => {
    test("should parse standard HTTPS GitHub URL", () => {
      const result = parseOwnerRepo("https://github.com/facebook/react");
      expect(result).toEqual({
        owner: "facebook",
        repo: "react"
      });
    });

    test("should parse HTTPS GitHub URL with .git extension", () => {
      const result = parseOwnerRepo("https://github.com/microsoft/typescript.git");
      expect(result).toEqual({
        owner: "microsoft",
        repo: "typescript"
      });
    });

    test("should handle URLs with hyphenated owner names", () => {
      const result = parseOwnerRepo("https://github.com/my-org/my-project");
      expect(result).toEqual({
        owner: "my-org",
        repo: "my-project"
      });
    });

    test("should handle URLs with underscored repo names", () => {
      const result = parseOwnerRepo("https://github.com/stakwork/sphinx_tribes");
      expect(result).toEqual({
        owner: "stakwork",
        repo: "sphinx_tribes"
      });
    });

    test("should handle URLs with numeric characters", () => {
      const result = parseOwnerRepo("https://github.com/user123/project-v2");
      expect(result).toEqual({
        owner: "user123",
        repo: "project-v2"
      });
    });
  });

  describe("SSH GitHub URL formats", () => {
    test("should parse SSH GitHub URL", () => {
      const result = parseOwnerRepo("git@github.com:stakwork/hive.git");
      expect(result).toEqual({
        owner: "stakwork",
        repo: "hive"
      });
    });

    test("should parse SSH GitHub URL without .git extension", () => {
      const result = parseOwnerRepo("git@github.com:vercel/next.js");
      expect(result).toEqual({
        owner: "vercel",
        repo: "next.js"
      });
    });

    test("should handle SSH URLs with special characters in repo name", () => {
      const result = parseOwnerRepo("git@github.com:facebook/react-native.git");
      expect(result).toEqual({
        owner: "facebook",
        repo: "react-native"
      });
    });
  });

  describe("owner/repo format", () => {
    test("should parse simple owner/repo format", () => {
      const result = parseOwnerRepo("stakwork/hive");
      expect(result).toEqual({
        owner: "stakwork",
        repo: "hive"
      });
    });

    test("should handle owner/repo with hyphens and underscores", () => {
      const result = parseOwnerRepo("my-org/project_name");
      expect(result).toEqual({
        owner: "my-org",
        repo: "project_name"
      });
    });

    test("should handle owner/repo with dots in repo name", () => {
      const result = parseOwnerRepo("vercel/next.js");
      expect(result).toEqual({
        owner: "vercel",
        repo: "next.js"
      });
    });
  });

  describe("error handling", () => {
    test("should throw error for invalid URL format", () => {
      expect(() => {
        parseOwnerRepo("invalid-url");
      }).toThrow("Invalid repository URL format: invalid-url");
    });

    test("should throw error for incomplete GitHub URL", () => {
      expect(() => {
        parseOwnerRepo("https://github.com/owner");
      }).toThrow("Invalid repository URL format: https://github.com/owner");
    });

    test("should throw error for URL with too many path segments", () => {
      expect(() => {
        parseOwnerRepo("https://github.com/owner/repo/extra");
      }).toThrow("Invalid repository URL format: https://github.com/owner/repo/extra");
    });

    test("should throw error for non-GitHub URL", () => {
      expect(() => {
        parseOwnerRepo("https://gitlab.com/owner/repo");
      }).toThrow("Invalid repository URL format: https://gitlab.com/owner/repo");
    });

    test("should throw error for malformed SSH URL", () => {
      expect(() => {
        parseOwnerRepo("git@github.com/owner/repo");
      }).toThrow("Invalid repository URL format: git@github.com/owner/repo");
    });

    test("should throw error for empty string", () => {
      expect(() => {
        parseOwnerRepo("");
      }).toThrow("Invalid repository URL format: ");
    });

    test("should throw error for URL with missing owner", () => {
      expect(() => {
        parseOwnerRepo("https://github.com//repo");
      }).toThrow("Invalid repository URL format: https://github.com//repo");
    });

    test("should throw error for URL with missing repo", () => {
      expect(() => {
        parseOwnerRepo("https://github.com/owner/");
      }).toThrow("Invalid repository URL format: https://github.com/owner/");
    });

    test("should throw error for owner/repo format with extra slashes", () => {
      expect(() => {
        parseOwnerRepo("owner/repo/extra");
      }).toThrow("Invalid repository URL format: owner/repo/extra");
    });

    test("should throw error for single component input", () => {
      expect(() => {
        parseOwnerRepo("just-a-string");
      }).toThrow("Invalid repository URL format: just-a-string");
    });
  });

  describe("edge cases", () => {
    test("should handle repos with all uppercase names", () => {
      const result = parseOwnerRepo("https://github.com/ORG/PROJECT");
      expect(result).toEqual({
        owner: "ORG",
        repo: "PROJECT"
      });
    });

    test("should handle single character owner and repo names", () => {
      const result = parseOwnerRepo("https://github.com/a/b");
      expect(result).toEqual({
        owner: "a",
        repo: "b"
      });
    });

    test("should handle very long owner and repo names", () => {
      const longOwner = "very-long-organization-name-with-many-hyphens";
      const longRepo = "very-long-repository-name-with-many-hyphens-and-underscores_here";
      const result = parseOwnerRepo(`https://github.com/${longOwner}/${longRepo}`);
      expect(result).toEqual({
        owner: longOwner,
        repo: longRepo
      });
    });

    test("should preserve exact case from input", () => {
      const result = parseOwnerRepo("MyOrg/MyRepo");
      expect(result).toEqual({
        owner: "MyOrg",
        repo: "MyRepo"
      });
    });

    test("should handle repos ending with numbers", () => {
      const result = parseOwnerRepo("https://github.com/org/project123");
      expect(result).toEqual({
        owner: "org",
        repo: "project123"
      });
    });
  });

  describe("return value structure", () => {
    test("should always return object with owner and repo properties", () => {
      const result = parseOwnerRepo("owner/repo");
      expect(result).toHaveProperty("owner");
      expect(result).toHaveProperty("repo");
      expect(typeof result.owner).toBe("string");
      expect(typeof result.repo).toBe("string");
    });

    test("should return strings for both owner and repo", () => {
      const result = parseOwnerRepo("test/repo");
      expect(typeof result.owner).toBe("string");
      expect(typeof result.repo).toBe("string");
    });

    test("should not return null or undefined values", () => {
      const result = parseOwnerRepo("owner/repo");
      expect(result.owner).not.toBeNull();
      expect(result.owner).not.toBeUndefined();
      expect(result.repo).not.toBeNull();
      expect(result.repo).not.toBeUndefined();
    });
  });
});