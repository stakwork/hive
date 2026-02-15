import { describe, test, expect } from "vitest";
import { extractRepoNameFromUrl, nextIndexedName } from "@/lib/utils/slug";

describe("extractRepoNameFromUrl", () => {
  describe("Valid GitHub URLs", () => {
    test("should extract repo name from HTTPS URL", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/my-repo");
      expect(result).toBe("my-repo");
    });

    test("should extract repo name with underscores", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/my_repo");
      expect(result).toBe("my_repo");
    });

    test("should extract and sanitize repo name with periods", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/my.repo_name");
      expect(result).toBe("my-repo_name");
    });

    test("should extract repo name from URL with .git suffix", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/my_repo.git");
      expect(result).toBe("my_repo");
    });

    test("should extract and sanitize repo name with periods and .git suffix", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/my.repo.git");
      expect(result).toBe("my-repo");
    });

    test("should extract repo name from SSH URL", () => {
      const result = extractRepoNameFromUrl("git@github.com:user/my_repo.git");
      expect(result).toBe("my_repo");
    });

    test("should extract repo name from SSH URL without .git", () => {
      const result = extractRepoNameFromUrl("git@github.com:user/my-repo");
      expect(result).toBe("my-repo");
    });

    test("should extract and sanitize SSH URL with periods", () => {
      const result = extractRepoNameFromUrl("git@github.com:user/my.repo.git");
      expect(result).toBe("my-repo");
    });

    test("should handle mixed hyphens and underscores", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/my-awesome_repo");
      expect(result).toBe("my-awesome_repo");
    });

    test("should convert uppercase to lowercase", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/MyRepo");
      expect(result).toBe("myrepo");
    });

    test("should convert mixed case with underscores to lowercase", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/My_Awesome_Repo");
      expect(result).toBe("my_awesome_repo");
    });
  });

  describe("Sanitization", () => {
    test("should replace multiple periods with multiple hyphens", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/my..repo");
      expect(result).toBe("my--repo");
    });

    test("should replace periods between underscores correctly", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/my_repo.name");
      expect(result).toBe("my_repo-name");
    });

    test("should preserve underscores and alphanumerics only", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/repo_123-test");
      expect(result).toBe("repo_123-test");
    });

    test("should sanitize special characters to hyphens", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/my@repo#name");
      expect(result).toBe("my-repo-name");
    });

    test("should handle repo names with numbers and periods", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/v2.0.1");
      expect(result).toBe("v2-0-1");
    });

    test("should handle complex mixed characters", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/my.repo_v2.0-beta");
      expect(result).toBe("my-repo_v2-0-beta");
    });
  });

  describe("Invalid URLs", () => {
    test("should return null for non-GitHub URL", () => {
      const result = extractRepoNameFromUrl("https://gitlab.com/user/repo");
      expect(result).toBeNull();
    });

    test("should return null for malformed URL", () => {
      const result = extractRepoNameFromUrl("not-a-url");
      expect(result).toBeNull();
    });

    test("should return null for GitHub URL without repo", () => {
      const result = extractRepoNameFromUrl("https://github.com/user");
      expect(result).toBeNull();
    });

    test("should return null for empty string", () => {
      const result = extractRepoNameFromUrl("");
      expect(result).toBeNull();
    });

    test("should return null for GitHub homepage", () => {
      const result = extractRepoNameFromUrl("https://github.com");
      expect(result).toBeNull();
    });
  });

  describe("Edge cases", () => {
    test("should handle repo name with only numbers", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/12345");
      expect(result).toBe("12345");
    });

    test("should handle single character repo name", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/a");
      expect(result).toBe("a");
    });

    test("should handle very long repo names", () => {
      const longName = "a".repeat(100);
      const result = extractRepoNameFromUrl(`https://github.com/user/${longName}`);
      expect(result).toBe(longName);
    });

    test("should handle repo name with trailing slash", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/my-repo/");
      expect(result).toBeNull(); // Should not match with trailing content
    });

    test("should not match URLs with paths after repo", () => {
      const result = extractRepoNameFromUrl("https://github.com/user/repo/tree/main");
      expect(result).toBeNull();
    });
  });
});

describe("nextIndexedName", () => {
  test("should return base name when pool is empty", () => {
    const result = nextIndexedName("repo", []);
    expect(result).toBe("repo");
  });

  test("should return base name when no matches in pool", () => {
    const result = nextIndexedName("repo", ["other-repo", "different"]);
    expect(result).toBe("repo");
  });

  test("should return repo-1 when base exists", () => {
    const result = nextIndexedName("repo", ["repo"]);
    expect(result).toBe("repo-1");
  });

  test("should return repo-2 when repo and repo-1 exist", () => {
    const result = nextIndexedName("repo", ["repo", "repo-1"]);
    expect(result).toBe("repo-2");
  });

  test("should find highest index and increment", () => {
    const result = nextIndexedName("repo", ["repo", "repo-1", "repo-5", "repo-2"]);
    expect(result).toBe("repo-6");
  });

  test("should handle gaps in numbering", () => {
    const result = nextIndexedName("repo", ["repo", "repo-1", "repo-10"]);
    expect(result).toBe("repo-11");
  });

  test("should be case insensitive", () => {
    const result = nextIndexedName("Repo", ["repo", "REPO-1"]);
    expect(result).toBe("Repo-2");
  });

  test("should handle base names with hyphens", () => {
    const result = nextIndexedName("my-repo", ["my-repo", "my-repo-1"]);
    expect(result).toBe("my-repo-2");
  });

  test("should handle base names with underscores", () => {
    const result = nextIndexedName("my_repo", ["my_repo", "my_repo-1"]);
    expect(result).toBe("my_repo-2");
  });

  test("should not confuse similar names", () => {
    const result = nextIndexedName("repo", ["repository", "repo2", "repos"]);
    expect(result).toBe("repo");
  });

  test("should handle special regex characters in base name", () => {
    const result = nextIndexedName("repo.test", ["repo.test", "repo.test-1"]);
    expect(result).toBe("repo.test-2");
  });
});
