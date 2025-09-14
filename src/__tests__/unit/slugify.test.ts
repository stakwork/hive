import { describe, test, expect } from "vitest";

// Import the slugify function from the seed script
// Note: In a real scenario, this function should be extracted to a shared utility module
function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

describe("slugify", () => {
  describe("normal transformations", () => {
    test("converts simple text to lowercase slug", () => {
      expect(slugify("Hello World")).toBe("hello-world");
    });

    test("replaces spaces with dashes", () => {
      expect(slugify("user workspace")).toBe("user-workspace");
    });

    test("handles mixed case input", () => {
      expect(slugify("MyAwesomeProject")).toBe("myawesomeproject");
    });

    test("preserves alphanumeric characters", () => {
      expect(slugify("project123")).toBe("project123");
    });

    test("handles numbers and letters together", () => {
      expect(slugify("Version 2.1.3")).toBe("version-2-1-3");
    });
  });

  describe("special character handling", () => {
    test("replaces special characters with dashes", () => {
      expect(slugify("user@domain.com")).toBe("user-domain-com");
    });

    test("handles punctuation marks", () => {
      expect(slugify("Hello, World!")).toBe("hello-world");
    });

    test("handles symbols and operators", () => {
      expect(slugify("C++ & JavaScript")).toBe("c-javascript");
    });

    test("handles parentheses and brackets", () => {
      expect(slugify("My Project (v1.0)")).toBe("my-project-v1-0");
    });

    test("handles underscores", () => {
      expect(slugify("snake_case_name")).toBe("snake-case-name");
    });

    test("handles forward slashes", () => {
      expect(slugify("path/to/file")).toBe("path-to-file");
    });
  });

  describe("edge cases", () => {
    test("handles empty string", () => {
      expect(slugify("")).toBe("");
    });

    test("handles string with only spaces", () => {
      expect(slugify("   ")).toBe("");
    });

    test("handles string with only special characters", () => {
      expect(slugify("!@#$%^&*()")).toBe("");
    });

    test("handles single character", () => {
      expect(slugify("a")).toBe("a");
    });

    test("handles single number", () => {
      expect(slugify("1")).toBe("1");
    });

    test("handles very long string", () => {
      const longInput = "This is a very long string with many words and special characters!@#$%^&*()";
      const expected = "this-is-a-very-long-string-with-many-words-and-special-characters";
      expect(slugify(longInput)).toBe(expected);
    });
  });

  describe("leading and trailing dash removal", () => {
    test("removes leading dashes", () => {
      expect(slugify("-hello-world")).toBe("hello-world");
    });

    test("removes trailing dashes", () => {
      expect(slugify("hello-world-")).toBe("hello-world");
    });

    test("removes both leading and trailing dashes", () => {
      expect(slugify("-hello-world-")).toBe("hello-world");
    });

    test("removes multiple leading dashes", () => {
      expect(slugify("---hello-world")).toBe("hello-world");
    });

    test("removes multiple trailing dashes", () => {
      expect(slugify("hello-world---")).toBe("hello-world");
    });

    test("handles string that becomes only dashes", () => {
      expect(slugify("!@#$")).toBe("");
    });
  });

  describe("consecutive dash collapsing", () => {
    test("collapses double dashes", () => {
      expect(slugify("hello--world")).toBe("hello-world");
    });

    test("collapses multiple consecutive dashes", () => {
      expect(slugify("hello----world")).toBe("hello-world");
    });

    test("handles multiple groups of consecutive dashes", () => {
      expect(slugify("hello--world--test")).toBe("hello-world-test");
    });

    test("collapses dashes created by special character replacement", () => {
      expect(slugify("hello@@world")).toBe("hello-world");
    });

    test("handles mixed consecutive special characters", () => {
      expect(slugify("hello!@#$%world")).toBe("hello-world");
    });
  });

  describe("real-world scenarios", () => {
    test("handles typical workspace name", () => {
      expect(slugify("John Doe's Workspace")).toBe("john-doe-s-workspace");
    });

    test("handles email-based slug", () => {
      expect(slugify("user@example.com workspace")).toBe("user-example-com-workspace");
    });

    test("handles project name with version", () => {
      expect(slugify("My Project v2.1.3")).toBe("my-project-v2-1-3");
    });

    test("handles GitHub username format", () => {
      expect(slugify("awesome-dev-2023")).toBe("awesome-dev-2023");
    });

    test("handles company name", () => {
      expect(slugify("Acme Corp. LLC")).toBe("acme-corp-llc");
    });

    test("handles app name with spaces and special chars", () => {
      expect(slugify("My Awesome App (Beta)")).toBe("my-awesome-app-beta");
    });
  });

  describe("internationalization", () => {
    test("handles accented characters", () => {
      expect(slugify("Café")).toBe("caf");
    });

    test("handles German umlauts", () => {
      expect(slugify("Müller")).toBe("m-ller");
    });

    test("handles Spanish characters", () => {
      expect(slugify("Niño")).toBe("ni-o");
    });

    test("handles mixed international characters", () => {
      expect(slugify("Résumé of José")).toBe("r-sum-of-jos");
    });
  });

  describe("boundary conditions", () => {
    test("handles whitespace variations", () => {
      expect(slugify("  hello   world  ")).toBe("hello-world");
    });

    test("handles tab characters", () => {
      expect(slugify("hello\tworld")).toBe("hello-world");
    });

    test("handles newline characters", () => {
      expect(slugify("hello\nworld")).toBe("hello-world");
    });

    test("handles carriage return characters", () => {
      expect(slugify("hello\rworld")).toBe("hello-world");
    });

    test("handles mixed whitespace", () => {
      expect(slugify("hello \t\n\r world")).toBe("hello-world");
    });
  });
});