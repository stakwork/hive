import { describe, test, expect } from "vitest";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";

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
