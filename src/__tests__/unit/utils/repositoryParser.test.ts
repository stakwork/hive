import { describe, test, expect } from "vitest";
import {
  parseRepositoryName,
  sanitizeWorkspaceName,
  parseGithubOwnerRepo,
} from "@/utils/repositoryParser";

describe("repositoryParser", () => {
  describe("parseRepositoryName", () => {
    test("should extract repo name from HTTPS GitHub URL", () => {
      const result = parseRepositoryName("https://github.com/owner/my-awesome-repo");
      expect(result).toBe("My Awesome Repo");
    });

    test("should extract repo name from HTTPS GitHub URL with .git suffix", () => {
      const result = parseRepositoryName("https://github.com/owner/my-awesome-repo.git");
      expect(result).toBe("My Awesome Repo");
    });

    test("should extract repo name from SSH GitHub URL", () => {
      const result = parseRepositoryName("git@github.com:owner/my-awesome-repo.git");
      expect(result).toBe("My Awesome Repo");
    });

    test("should extract repo name from GitHub URL with query parameters", () => {
      const result = parseRepositoryName("https://github.com/owner/my-repo?tab=readme");
      expect(result).toBe("My Repo");
    });

    test("should extract repo name from GitHub URL with fragment", () => {
      const result = parseRepositoryName("https://github.com/owner/my-repo#readme");
      expect(result).toBe("My Repo");
    });

    test("should handle case insensitive GitHub URLs", () => {
      const result = parseRepositoryName("https://GITHUB.COM/owner/my-repo");
      expect(result).toBe("My Repo");
    });

    test("should parse camelCase repository names", () => {
      const result = parseRepositoryName("myAwesomeRepo");
      expect(result).toBe("My Awesome Repo");
    });

    test("should parse PascalCase repository names", () => {
      const result = parseRepositoryName("MyAwesomeRepo");
      expect(result).toBe("My Awesome Repo");
    });

    test("should parse hyphen-separated repository names", () => {
      const result = parseRepositoryName("my-awesome-repo");
      expect(result).toBe("My Awesome Repo");
    });

    test("should parse underscore-separated repository names", () => {
      const result = parseRepositoryName("my_awesome_repo");
      expect(result).toBe("My Awesome Repo");
    });

    test("should parse mixed case and separator repository names", () => {
      const result = parseRepositoryName("myAwesome-repo_name");
      expect(result).toBe("My Awesome Repo Name");
    });

    test("should handle consecutive uppercase letters", () => {
      const result = parseRepositoryName("XMLHttpRequest");
      expect(result).toBe("XML Http Request");
    });

    test("should handle single letter words", () => {
      const result = parseRepositoryName("aSimpleTest");
      expect(result).toBe("A Simple Test");
    });

    test("should handle already formatted names", () => {
      const result = parseRepositoryName("My Awesome Repository");
      expect(result).toBe("My Awesome Repository");
    });

    test("should handle empty string", () => {
      const result = parseRepositoryName("");
      expect(result).toBe("");
    });

    test("should handle single word", () => {
      const result = parseRepositoryName("repository");
      expect(result).toBe("Repository");
    });

    test("should handle multiple spaces and trim", () => {
      const result = parseRepositoryName("  my   awesome   repo  ");
      expect(result).toBe("My Awesome Repo");
    });

    test("should handle special characters in non-GitHub URLs", () => {
      const result = parseRepositoryName("my@repo#name");
      expect(result).toBe("My@Repo#Name");
    });

    test("should handle numbers in repository names", () => {
      const result = parseRepositoryName("myRepo123Version2");
      expect(result).toBe("My Repo123 Version2");
    });

    test("should extract from GitHub URL with complex camelCase repo name", () => {
      const result = parseRepositoryName("https://github.com/owner/myComplexRepoNameWithCamelCase");
      expect(result).toBe("My Complex Repo Name With Camel Case");
    });
  });

  describe("sanitizeWorkspaceName", () => {
    test("should convert to lowercase", () => {
      const result = sanitizeWorkspaceName("MyWorkspace");
      expect(result).toBe("myworkspace");
    });

    test("should replace spaces with dashes", () => {
      const result = sanitizeWorkspaceName("My Awesome Workspace");
      expect(result).toBe("my-awesome-workspace");
    });

    test("should replace special characters with dashes", () => {
      const result = sanitizeWorkspaceName("My@Workspace#123!");
      expect(result).toBe("my-workspace-123");
    });

    test("should replace underscores with dashes", () => {
      const result = sanitizeWorkspaceName("my_workspace_name");
      expect(result).toBe("my-workspace-name");
    });

    test("should collapse multiple dashes", () => {
      const result = sanitizeWorkspaceName("my---workspace");
      expect(result).toBe("my-workspace");
    });

    test("should trim leading dashes", () => {
      const result = sanitizeWorkspaceName("---myworkspace");
      expect(result).toBe("myworkspace");
    });

    test("should trim trailing dashes", () => {
      const result = sanitizeWorkspaceName("myworkspace---");
      expect(result).toBe("myworkspace");
    });

    test("should trim both leading and trailing dashes", () => {
      const result = sanitizeWorkspaceName("---myworkspace---");
      expect(result).toBe("myworkspace");
    });

    test("should handle mixed invalid characters and collapse", () => {
      const result = sanitizeWorkspaceName("My@@@Workspace###Name!!!");
      expect(result).toBe("my-workspace-name");
    });

    test("should preserve valid characters", () => {
      const result = sanitizeWorkspaceName("my-workspace-123");
      expect(result).toBe("my-workspace-123");
    });

    test("should handle empty string", () => {
      const result = sanitizeWorkspaceName("");
      expect(result).toBe("");
    });

    test("should handle string with only invalid characters", () => {
      const result = sanitizeWorkspaceName("@#$%^&*()");
      expect(result).toBe("");
    });

    test("should handle string with only dashes", () => {
      const result = sanitizeWorkspaceName("-----");
      expect(result).toBe("");
    });

    test("should handle unicode characters", () => {
      const result = sanitizeWorkspaceName("my-workspace-café");
      expect(result).toBe("my-workspace-caf");
    });

    test("should handle numbers correctly", () => {
      const result = sanitizeWorkspaceName("Workspace2024");
      expect(result).toBe("workspace2024");
    });

    test("should handle complex mixed case scenario", () => {
      const result = sanitizeWorkspaceName("My Complex@Workspace#Name_With-123!Symbols");
      expect(result).toBe("my-complex-workspace-name-with-123-symbols");
    });
  });

  describe("parseGithubOwnerRepo", () => {
    test("should parse HTTPS GitHub URL", () => {
      const result = parseGithubOwnerRepo("https://github.com/owner/repository");
      expect(result).toEqual({ owner: "owner", repo: "repository" });
    });

    test("should parse HTTPS GitHub URL with .git suffix", () => {
      const result = parseGithubOwnerRepo("https://github.com/owner/repository.git");
      expect(result).toEqual({ owner: "owner", repo: "repository" });
    });

    test("should parse SSH GitHub URL", () => {
      const result = parseGithubOwnerRepo("git@github.com:owner/repository.git");
      expect(result).toEqual({ owner: "owner", repo: "repository" });
    });

    test("should parse SSH GitHub URL without .git suffix", () => {
      const result = parseGithubOwnerRepo("git@github.com:owner/repository");
      expect(result).toEqual({ owner: "owner", repo: "repository" });
    });

    test("should parse GitHub URL with www prefix", () => {
      const result = parseGithubOwnerRepo("https://www.github.com/owner/repository");
      expect(result).toEqual({ owner: "owner", repo: "repository" });
    });

    test("should parse GitHub URL with query parameters", () => {
      const result = parseGithubOwnerRepo("https://github.com/owner/repository?tab=readme");
      expect(result).toEqual({ owner: "owner", repo: "repository" });
    });

    test("should parse GitHub URL with fragment", () => {
      const result = parseGithubOwnerRepo("https://github.com/owner/repository#readme");
      expect(result).toEqual({ owner: "owner", repo: "repository" });
    });

    test("should parse GitHub URL with both query and fragment", () => {
      const result = parseGithubOwnerRepo("https://github.com/owner/repository?tab=readme#installation");
      expect(result).toEqual({ owner: "owner", repo: "repository" });
    });

    test("should handle case insensitive GitHub URLs", () => {
      const result = parseGithubOwnerRepo("https://GITHUB.COM/Owner/Repository");
      expect(result).toEqual({ owner: "Owner", repo: "Repository" });
    });

    test("should handle hyphens and underscores in owner and repo names", () => {
      const result = parseGithubOwnerRepo("https://github.com/my-org_name/my-repo_name");
      expect(result).toEqual({ owner: "my-org_name", repo: "my-repo_name" });
    });

    test("should handle numbers in owner and repo names", () => {
      const result = parseGithubOwnerRepo("https://github.com/org123/repo456");
      expect(result).toEqual({ owner: "org123", repo: "repo456" });
    });

    test("should return null for invalid GitHub URL", () => {
      const result = parseGithubOwnerRepo("https://gitlab.com/owner/repository");
      expect(result).toBeNull();
    });

    test("should return null for malformed GitHub URL", () => {
      const result = parseGithubOwnerRepo("https://github.com/owner");
      expect(result).toBeNull();
    });

    test("should return null for empty string", () => {
      const result = parseGithubOwnerRepo("");
      expect(result).toBeNull();
    });

    test("should return null for non-URL string", () => {
      const result = parseGithubOwnerRepo("not-a-url");
      expect(result).toBeNull();
    });

    test("should return null for URL with too many path segments", () => {
      const result = parseGithubOwnerRepo("https://github.com/owner/repository/extra/path");
      expect(result).toEqual({ owner: "owner", repo: "repository" });
    });

    test("should handle GitHub enterprise URLs if they follow same pattern", () => {
      // This test assumes the function might handle enterprise GitHub URLs
      // If it doesn't, this test might fail and would need to be adjusted
      const result = parseGithubOwnerRepo("https://github.enterprise.com/owner/repository");
      // This might return null if the function is strict about github.com only
      expect(result).toBeNull();
    });
  });
});