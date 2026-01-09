import { describe, test, expect } from "vitest";
import { slugify } from "@/utils/slugify";

describe("slugify", () => {
  describe("Basic transformations", () => {
    test("should convert dots to hyphens", () => {
      expect(slugify("cal.com")).toBe("cal-com");
    });

    test("should convert multiple dots to hyphens", () => {
      expect(slugify("my.awesome.repo")).toBe("my-awesome-repo");
    });

    test("should handle mixed case with dots", () => {
      expect(slugify("Test.Repo.2.0")).toBe("test-repo-2-0");
    });

    test("should convert to lowercase", () => {
      expect(slugify("MyProject")).toBe("myproject");
    });

    test("should replace spaces with hyphens", () => {
      expect(slugify("my project")).toBe("my-project");
    });

    test("should handle underscores", () => {
      expect(slugify("my_project")).toBe("my-project");
    });
  });

  describe("Edge cases with dots", () => {
    test("should handle leading dots", () => {
      expect(slugify(".repo")).toBe("repo");
    });

    test("should handle trailing dots", () => {
      expect(slugify("repo.")).toBe("repo");
    });

    test("should handle leading and trailing dots", () => {
      expect(slugify(".repo.")).toBe("repo");
    });

    test("should handle consecutive dots", () => {
      expect(slugify("my..repo")).toBe("my-repo");
    });

    test("should handle multiple consecutive dots", () => {
      expect(slugify("my...awesome...repo")).toBe("my-awesome-repo");
    });

    test("should handle dots with spaces", () => {
      expect(slugify("my. repo .name")).toBe("my-repo-name");
    });
  });

  describe("Special characters", () => {
    test("should remove special characters", () => {
      expect(slugify("my@project!")).toBe("my-project");
    });

    test("should handle mixed special characters", () => {
      expect(slugify("my-project@2024!")).toBe("my-project-2024");
    });

    test("should handle parentheses", () => {
      expect(slugify("project(dev)")).toBe("project-dev");
    });

    test("should handle brackets", () => {
      expect(slugify("project[new]")).toBe("project-new");
    });

    test("should handle slashes", () => {
      expect(slugify("project/repo")).toBe("project-repo");
    });
  });

  describe("Hyphen handling", () => {
    test("should preserve single hyphens", () => {
      expect(slugify("my-project")).toBe("my-project");
    });

    test("should collapse consecutive hyphens", () => {
      expect(slugify("my--project")).toBe("my-project");
    });

    test("should remove leading hyphens", () => {
      expect(slugify("-project")).toBe("project");
    });

    test("should remove trailing hyphens", () => {
      expect(slugify("project-")).toBe("project");
    });

    test("should handle multiple leading and trailing hyphens", () => {
      expect(slugify("---project---")).toBe("project");
    });
  });

  describe("Idempotency", () => {
    test("should be idempotent for already valid slugs", () => {
      const slug = "my-project";
      expect(slugify(slug)).toBe(slug);
      expect(slugify(slugify(slug))).toBe(slug);
    });

    test("should be idempotent for complex inputs", () => {
      const result = slugify("My.Awesome...Project!!!");
      expect(slugify(result)).toBe(result);
    });
  });

  describe("Real-world repository names", () => {
    test("should handle cal.com", () => {
      expect(slugify("cal.com")).toBe("cal-com");
    });

    test("should handle node.js", () => {
      expect(slugify("node.js")).toBe("node-js");
    });

    test("should handle next.js", () => {
      expect(slugify("next.js")).toBe("next-js");
    });

    test("should handle vercel/next.js format", () => {
      expect(slugify("vercel/next.js")).toBe("vercel-next-js");
    });

    test("should handle repository with version", () => {
      expect(slugify("project-v2.0.1")).toBe("project-v2-0-1");
    });

    test("should handle .NET projects", () => {
      expect(slugify("MyProject.NET")).toBe("myproject-net");
    });
  });

  describe("Alphanumeric content", () => {
    test("should preserve numbers", () => {
      expect(slugify("project123")).toBe("project123");
    });

    test("should handle numbers with dots", () => {
      expect(slugify("v2.0")).toBe("v2-0");
    });

    test("should handle mixed alphanumeric", () => {
      expect(slugify("MyApp2024")).toBe("myapp2024");
    });
  });

  describe("Empty and minimal inputs", () => {
    test("should handle empty string", () => {
      expect(slugify("")).toBe("");
    });

    test("should handle single character", () => {
      expect(slugify("a")).toBe("a");
    });

    test("should handle single dot", () => {
      expect(slugify(".")).toBe("");
    });

    test("should handle only dots", () => {
      expect(slugify("...")).toBe("");
    });

    test("should handle only special characters", () => {
      expect(slugify("@#$%")).toBe("");
    });

    test("should handle whitespace only", () => {
      expect(slugify("   ")).toBe("");
    });
  });

  describe("Complex scenarios", () => {
    test("should handle GitHub repository URL fragments", () => {
      expect(slugify("my.awesome.project.git")).toBe("my-awesome-project-git");
    });

    test("should handle domain-like names", () => {
      expect(slugify("api.example.com")).toBe("api-example-com");
    });

    test("should handle file extensions", () => {
      expect(slugify("project.config.js")).toBe("project-config-js");
    });

    test("should handle camelCase with dots", () => {
      expect(slugify("myApp.config")).toBe("myapp-config");
    });
  });
});
