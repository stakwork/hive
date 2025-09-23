import { describe, test, expect } from "vitest";
import {
  parseRepositoryName,
  sanitizeWorkspaceName,
  parseGithubOwnerRepo,
} from "@/utils/repositoryParser";

describe("parseRepositoryName", () => {
  test("should parse simple repository names", () => {
    expect(parseRepositoryName("simple-repo")).toBe("Simple Repo");
    expect(parseRepositoryName("my_project")).toBe("My Project");
    expect(parseRepositoryName("test-repository")).toBe("Test Repository");
  });

  test("should extract repository name from GitHub URLs", () => {
    expect(parseRepositoryName("https://github.com/user/awesome-project")).toBe("Awesome Project");
    expect(parseRepositoryName("http://github.com/owner/my-repo")).toBe("My Repo");
    expect(parseRepositoryName("github.com/dev/cool-app")).toBe("Cool App");
    expect(parseRepositoryName("https://github.com/org/test_repo")).toBe("Test Repo");
  });

  test("should handle GitHub URLs with query parameters and fragments", () => {
    expect(parseRepositoryName("https://github.com/user/project?tab=readme")).toBe("Project");
    expect(parseRepositoryName("https://github.com/user/app#installation")).toBe("App");
    expect(parseRepositoryName("https://github.com/user/repo?tab=readme#docs")).toBe("Repo");
  });

  test("should handle GitHub URLs with .git extension", () => {
    expect(parseRepositoryName("https://github.com/user/project.git")).toBe("Project.Git");
    expect(parseRepositoryName("github.com/user/my-app.git")).toBe("My App.Git");
  });

  test("should convert camelCase to proper words", () => {
    expect(parseRepositoryName("myAwesomeProject")).toBe("My Awesome Project");
    expect(parseRepositoryName("theQuickBrownFox")).toBe("The Quick Brown Fox");
    expect(parseRepositoryName("XMLHttpRequest")).toBe("XML Http Request");
  });

  test("should convert PascalCase to proper words", () => {
    expect(parseRepositoryName("MyAwesomeProject")).toBe("My Awesome Project");
    expect(parseRepositoryName("TheQuickBrownFox")).toBe("The Quick Brown Fox");
    expect(parseRepositoryName("ReactNativeApp")).toBe("React Native App");
  });

  test("should handle mixed case with acronyms", () => {
    expect(parseRepositoryName("HTTPClient")).toBe("HTTP Client");
    expect(parseRepositoryName("XMLParserAPI")).toBe("XML Parser API");
    expect(parseRepositoryName("APIResponse")).toBe("API Response");
  });

  test("should handle underscores and hyphens", () => {
    expect(parseRepositoryName("my-awesome_project")).toBe("My Awesome Project");
    expect(parseRepositoryName("test_repo-name")).toBe("Test Repo Name");
    expect(parseRepositoryName("snake_case_name")).toBe("Snake Case Name");
  });

  test("should handle multiple spaces and normalize them", () => {
    expect(parseRepositoryName("my   project")).toBe("My Project");
    expect(parseRepositoryName("test    repo     name")).toBe("Test Repo Name");
  });

  test("should handle single word names", () => {
    expect(parseRepositoryName("project")).toBe("Project");
    expect(parseRepositoryName("app")).toBe("App");
    expect(parseRepositoryName("UPPERCASE")).toBe("UPPERCASE");
  });

  test("should handle empty and whitespace-only strings", () => {
    expect(parseRepositoryName("")).toBe("");
    expect(parseRepositoryName("   ")).toBe("");
    expect(parseRepositoryName("\t\n")).toBe("");
  });

  test("should handle numbers in repository names", () => {
    expect(parseRepositoryName("project-v2")).toBe("Project V2");
    expect(parseRepositoryName("app2023")).toBe("App2023");
    expect(parseRepositoryName("v1.0-release")).toBe("V1.0 Release");
  });

  test("should handle special characters", () => {
    expect(parseRepositoryName("my.project")).toBe("My.Project");
    expect(parseRepositoryName("app@2023")).toBe("App@2023");
    expect(parseRepositoryName("test+repo")).toBe("Test+Repo");
  });

  test("should handle complex GitHub URLs with different domains", () => {
    expect(parseRepositoryName("https://www.github.com/user/repo")).toBe("Repo");
    expect(parseRepositoryName("http://www.github.com/org/project")).toBe("Project");
  });

  test("should handle case insensitive GitHub URL matching", () => {
    expect(parseRepositoryName("https://GITHUB.COM/user/MyProject")).toBe("My Project");
    expect(parseRepositoryName("HTTP://GitHub.com/org/testRepo")).toBe("Test Repo");
  });

  test("should not extract from non-GitHub URLs", () => {
    expect(parseRepositoryName("https://gitlab.com/user/project")).toBe("Https://Gitlab.Com/User/Project");
    expect(parseRepositoryName("https://bitbucket.org/user/repo")).toBe("Https://Bitbucket.Org/User/Repo");
  });
});

describe("sanitizeWorkspaceName", () => {
  test("should convert to lowercase", () => {
    expect(sanitizeWorkspaceName("MyProject")).toBe("myproject");
    expect(sanitizeWorkspaceName("UPPERCASE")).toBe("uppercase");
    expect(sanitizeWorkspaceName("MiXeD cAsE")).toBe("mixed-case");
  });

  test("should replace invalid domain characters with dashes", () => {
    expect(sanitizeWorkspaceName("my project")).toBe("my-project");
    expect(sanitizeWorkspaceName("test@repo")).toBe("test-repo");
    expect(sanitizeWorkspaceName("app#123")).toBe("app-123");
    expect(sanitizeWorkspaceName("project$name")).toBe("project-name");
  });

  test("should replace multiple invalid characters with single dash", () => {
    expect(sanitizeWorkspaceName("my@@project")).toBe("my-project");
    expect(sanitizeWorkspaceName("test   repo")).toBe("test-repo");
    expect(sanitizeWorkspaceName("app!!!name")).toBe("app-name");
  });

  test("should collapse multiple consecutive dashes", () => {
    expect(sanitizeWorkspaceName("my---project")).toBe("my-project");
    expect(sanitizeWorkspaceName("test--repo--name")).toBe("test-repo-name");
    expect(sanitizeWorkspaceName("a----b")).toBe("a-b");
  });

  test("should remove leading and trailing dashes", () => {
    expect(sanitizeWorkspaceName("-myproject")).toBe("myproject");
    expect(sanitizeWorkspaceName("myproject-")).toBe("myproject");
    expect(sanitizeWorkspaceName("-my-project-")).toBe("my-project");
    expect(sanitizeWorkspaceName("---project---")).toBe("project");
  });

  test("should preserve valid domain characters", () => {
    expect(sanitizeWorkspaceName("my-project")).toBe("my-project");
    expect(sanitizeWorkspaceName("test123")).toBe("test123");
    expect(sanitizeWorkspaceName("app-v2")).toBe("app-v2");
  });

  test("should handle numbers correctly", () => {
    expect(sanitizeWorkspaceName("project123")).toBe("project123");
    expect(sanitizeWorkspaceName("123project")).toBe("123project");
    expect(sanitizeWorkspaceName("v1.0")).toBe("v1-0");
  });

  test("should handle empty and whitespace-only strings", () => {
    expect(sanitizeWorkspaceName("")).toBe("");
    expect(sanitizeWorkspaceName("   ")).toBe("");
    expect(sanitizeWorkspaceName("---")).toBe("");
    expect(sanitizeWorkspaceName("\t\n")).toBe("");
  });

  test("should handle strings with only invalid characters", () => {
    expect(sanitizeWorkspaceName("@#$%")).toBe("");
    expect(sanitizeWorkspaceName("!!!")).toBe("");
    expect(sanitizeWorkspaceName("   @@@   ")).toBe("");
  });

  test("should handle complex mixed scenarios", () => {
    expect(sanitizeWorkspaceName("My Awesome Project!")).toBe("my-awesome-project");
    expect(sanitizeWorkspaceName("--Test@Repo#123--")).toBe("test-repo-123");
    expect(sanitizeWorkspaceName("APP___NAME")).toBe("app-name");
  });

  test("should handle unicode and special characters", () => {
    expect(sanitizeWorkspaceName("café")).toBe("caf");
    expect(sanitizeWorkspaceName("project™")).toBe("project");
    expect(sanitizeWorkspaceName("test©repo")).toBe("test-repo");
  });

  test("should handle very long names", () => {
    const longName = "a".repeat(100);
    const result = sanitizeWorkspaceName(longName);
    expect(result).toBe(longName);
    expect(result).toHaveLength(100);
  });
});

describe("parseGithubOwnerRepo", () => {
  test("should parse HTTPS GitHub URLs", () => {
    expect(parseGithubOwnerRepo("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("https://github.com/myorg/myproject")).toEqual({
      owner: "myorg",
      repo: "myproject",
    });
  });

  test("should parse HTTPS GitHub URLs with .git extension", () => {
    expect(parseGithubOwnerRepo("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("https://github.com/user/project.git")).toEqual({
      owner: "user",
      repo: "project",
    });
  });

  test("should parse HTTP GitHub URLs", () => {
    expect(parseGithubOwnerRepo("http://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("http://github.com/user/app.git")).toEqual({
      owner: "user",
      repo: "app",
    });
  });

  test("should parse SSH GitHub URLs", () => {
    expect(parseGithubOwnerRepo("git@github.com:owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("git@github.com:user/project")).toEqual({
      owner: "user",
      repo: "project",
    });
  });

  test("should parse partial GitHub URLs without protocol", () => {
    expect(parseGithubOwnerRepo("github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("github.com/user/project.git")).toEqual({
      owner: "user",
      repo: "project",
    });
  });

  test("should handle URLs with www subdomain", () => {
    expect(parseGithubOwnerRepo("https://www.github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("www.github.com/user/project")).toEqual({
      owner: "user",
      repo: "project",
    });
  });

  test("should handle case insensitive GitHub domains", () => {
    expect(parseGithubOwnerRepo("https://GITHUB.COM/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("GITHUB.com/user/project")).toEqual({
      owner: "user",
      repo: "project",
    });
  });

  test("should handle URLs with query parameters", () => {
    expect(parseGithubOwnerRepo("https://github.com/owner/repo?tab=readme")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("github.com/user/project?ref=main")).toEqual({
      owner: "user",
      repo: "project",
    });
  });

  test("should handle URLs with fragments", () => {
    expect(parseGithubOwnerRepo("https://github.com/owner/repo#readme")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("github.com/user/project#installation")).toEqual({
      owner: "user",
      repo: "project",
    });
  });

  test("should handle URLs with both query parameters and fragments", () => {
    expect(parseGithubOwnerRepo("https://github.com/owner/repo?tab=readme#docs")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  test("should handle trailing slashes", () => {
    expect(parseGithubOwnerRepo("https://github.com/owner/repo/")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("github.com/user/project/")).toEqual({
      owner: "user",
      repo: "project",
    });
  });

  test("should handle URLs with additional path segments", () => {
    expect(parseGithubOwnerRepo("https://github.com/owner/repo/tree/main")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("github.com/user/project/issues/123")).toEqual({
      owner: "user",
      repo: "project",
    });
  });

  test("should throw error for non-GitHub URLs", () => {
    expect(() => parseGithubOwnerRepo("https://gitlab.com/owner/repo")).toThrow(
      "Unable to parse GitHub repository URL"
    );
    expect(() => parseGithubOwnerRepo("https://bitbucket.org/owner/repo")).toThrow(
      "Unable to parse GitHub repository URL"
    );
    expect(() => parseGithubOwnerRepo("https://example.com/owner/repo")).toThrow(
      "Unable to parse GitHub repository URL"
    );
  });

  test("should throw error for invalid GitHub URLs", () => {
    expect(() => parseGithubOwnerRepo("https://github.com/")).toThrow(
      "Unable to parse GitHub repository URL"
    );
    expect(() => parseGithubOwnerRepo("https://github.com/owner")).toThrow(
      "Unable to parse GitHub repository URL"
    );
    expect(() => parseGithubOwnerRepo("github.com/")).toThrow(
      "Unable to parse GitHub repository URL"
    );
  });

  test("should throw error for malformed URLs", () => {
    expect(() => parseGithubOwnerRepo("not-a-url")).toThrow(
      "Unable to parse GitHub repository URL"
    );
    expect(() => parseGithubOwnerRepo("")).toThrow(
      "Unable to parse GitHub repository URL"
    );
    expect(() => parseGithubOwnerRepo("just-text")).toThrow(
      "Unable to parse GitHub repository URL"
    );
  });

  test("should handle special characters in owner and repo names", () => {
    expect(parseGithubOwnerRepo("https://github.com/my-org/my-repo")).toEqual({
      owner: "my-org",
      repo: "my-repo",
    });
    expect(parseGithubOwnerRepo("git@github.com:user_name/repo.name.git")).toEqual({
      owner: "user_name",
      repo: "repo.name",
    });
  });

  test("should handle numeric owner and repo names", () => {
    expect(parseGithubOwnerRepo("https://github.com/123user/456repo")).toEqual({
      owner: "123user",
      repo: "456repo",
    });
    expect(parseGithubOwnerRepo("git@github.com:2023org/v2.0")).toEqual({
      owner: "2023org",
      repo: "v2.0",
    });
  });

  test("should preserve case in owner and repo names", () => {
    expect(parseGithubOwnerRepo("https://github.com/MyOrg/MyRepo")).toEqual({
      owner: "MyOrg",
      repo: "MyRepo",
    });
    expect(parseGithubOwnerRepo("git@github.com:CamelCase/PascalCase.git")).toEqual({
      owner: "CamelCase",
      repo: "PascalCase",
    });
  });

  test("should handle edge case SSH formats", () => {
    expect(parseGithubOwnerRepo("git@github.com:owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
    expect(parseGithubOwnerRepo("git@github.com:a/b.git")).toEqual({
      owner: "a",
      repo: "b",
    });
  });

  test("should handle multiple .git extensions correctly", () => {
    expect(parseGithubOwnerRepo("https://github.com/owner/repo.git.git")).toEqual({
      owner: "owner",
      repo: "repo.git",
    });
  });

  test("should throw error for URLs with wrong GitHub hostname", () => {
    expect(() => parseGithubOwnerRepo("https://github.net/owner/repo")).toThrow(
      "Unable to parse GitHub repository URL"
    );
	});
});
