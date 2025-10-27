import { describe, test, expect } from "vitest";
import { convertGlobsToRegex } from "@/lib/utils/glob";

describe("convertGlobsToRegex", () => {
  describe("empty input handling", () => {
    test("should return empty string for empty input", () => {
      expect(convertGlobsToRegex("")).toBe("");
    });

    test("should return empty string for whitespace-only input", () => {
      expect(convertGlobsToRegex("   ")).toBe("");
      expect(convertGlobsToRegex("\t\n")).toBe("");
    });

    test("should return empty string for input with only commas", () => {
      expect(convertGlobsToRegex(",,,")).toBe("");
    });

    test("should return empty string for input with commas and whitespace", () => {
      expect(convertGlobsToRegex(" , , ")).toBe("");
    });
  });

  describe("single glob pattern", () => {
    test("should convert simple wildcard pattern", () => {
      const result = convertGlobsToRegex("*.test.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("test\\.ts");
      expect(() => new RegExp(result)).not.toThrow();
    });

    test("should convert pattern with globstar", () => {
      const result = convertGlobsToRegex("**/*.test.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("test\\.ts");
      expect(() => new RegExp(result)).not.toThrow();
    });

    test("should handle pattern with leading/trailing whitespace", () => {
      const result = convertGlobsToRegex("  *.test.ts  ");
      expect(result).toBeTruthy();
      expect(result).toContain("test\\.ts");
    });

    test("should convert pattern with directory path", () => {
      const result = convertGlobsToRegex("src/**/*.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("src");
      expect(result).toContain("\\.ts");
    });

    test("should convert pattern with file extensions in braces", () => {
      const result = convertGlobsToRegex("*.{js,ts}");
      expect(result).toBeTruthy();
      expect(result).toMatch(/js|ts/);
      expect(() => new RegExp(result)).not.toThrow();
    });

    test("should convert pattern with question mark wildcard", () => {
      const result = convertGlobsToRegex("?.test.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("test\\.ts");
    });

    test("should convert pattern with character class", () => {
      const result = convertGlobsToRegex("[abc].test.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("test\\.ts");
      // Character class brackets should be escaped in regex
      expect(result).toMatch(/\\\[abc\\\]/);
    });
  });

  describe("multiple glob patterns", () => {
    test("should create alternation pattern for two patterns", () => {
      const result = convertGlobsToRegex("*.test.ts,*.spec.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
      expect(result).toMatch(/^\(/); // Should start with (
      expect(result).toMatch(/\)$/); // Should end with )
    });

    test("should create alternation pattern for three patterns", () => {
      const result = convertGlobsToRegex("*.test.ts,*.spec.ts,*.e2e.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
      // Should have two | separators for three patterns
      expect(result.split("|").length).toBe(3);
    });

    test("should handle patterns with whitespace around commas", () => {
      const result = convertGlobsToRegex("*.test.ts , *.spec.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
    });

    test("should handle patterns with multiple spaces", () => {
      const result = convertGlobsToRegex("  *.test.ts  ,  *.spec.ts  ");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
    });

    test("should create alternation for complex patterns", () => {
      const result = convertGlobsToRegex("src/**/*.test.ts,tests/**/*.spec.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
      expect(result).toContain("src");
      expect(result).toContain("tests");
    });
  });

  describe("edge cases with commas", () => {
    test("should handle trailing comma", () => {
      const result = convertGlobsToRegex("*.test.ts,");
      expect(result).toBeTruthy();
      expect(result).not.toContain("|"); // Should be single pattern
    });

    test("should handle leading comma", () => {
      const result = convertGlobsToRegex(",*.test.ts");
      expect(result).toBeTruthy();
      expect(result).not.toContain("|"); // Should be single pattern
    });

    test("should handle multiple consecutive commas", () => {
      const result = convertGlobsToRegex("*.test.ts,,,*.spec.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
      // Should still create alternation for two valid patterns
      expect(result.split("|").length).toBe(2);
    });

    test("should handle empty patterns in list", () => {
      const result = convertGlobsToRegex("*.test.ts,,*.spec.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
      // Should filter out empty patterns
      expect(result.split("|").length).toBe(2);
    });

    test("should handle comma with only whitespace between patterns", () => {
      const result = convertGlobsToRegex("*.test.ts, ,*.spec.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
    });
  });

  describe("globstar pattern support", () => {
    test("should convert globstar at beginning", () => {
      const result = convertGlobsToRegex("**/test/**");
      expect(result).toBeTruthy();
      expect(result).toContain("test");
    });

    test("should convert globstar in middle", () => {
      const result = convertGlobsToRegex("src/**/test/**/*.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("src");
      expect(result).toContain("test");
    });

    test("should convert multiple globstar patterns", () => {
      const result = convertGlobsToRegex("**/*.test.ts,**/*.spec.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
    });

    test("should handle nested directory with globstar", () => {
      const result = convertGlobsToRegex("src/**/__tests__/**/*.test.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("src");
      expect(result).toContain("__tests__");
    });
  });

  describe("real-world test patterns", () => {
    test("should convert unit test glob pattern", () => {
      const result = convertGlobsToRegex("src/__tests__/unit/**/*.test.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("__tests__");
      expect(result).toContain("unit");
    });

    test("should convert integration test glob pattern", () => {
      const result = convertGlobsToRegex("src/__tests__/integration/**/*.test.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("integration");
    });

    test("should convert e2e test glob pattern", () => {
      const result = convertGlobsToRegex("src/__tests__/e2e/**/*.spec.ts");
      expect(result).toBeTruthy();
      expect(result).toContain("e2e");
    });

    test("should convert combined test patterns", () => {
      const result = convertGlobsToRegex(
        "src/__tests__/unit/**/*.test.ts,src/__tests__/integration/**/*.test.ts"
      );
      expect(result).toBeTruthy();
      expect(result).toContain("|");
      expect(result).toContain("unit");
      expect(result).toContain("integration");
    });

    test("should handle typical ignore patterns", () => {
      const result = convertGlobsToRegex("**/node_modules/**,**/dist/**,**/.git/**");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
      expect(result).toContain("node_modules");
      expect(result).toContain("dist");
      expect(result).toContain("\\.git");
    });
  });

  describe("regex output validation", () => {
    test("single pattern should not be wrapped in parentheses", () => {
      const result = convertGlobsToRegex("*.test.ts");
      expect(result).toBeTruthy();
      expect(result).not.toMatch(/^\(/);
    });

    test("multiple patterns should be wrapped in parentheses", () => {
      const result = convertGlobsToRegex("*.test.ts,*.spec.ts");
      expect(result).toBeTruthy();
      expect(result).toMatch(/^\(/);
      expect(result).toMatch(/\)$/);
    });

    test("output should be valid regex source", () => {
      const result = convertGlobsToRegex("*.test.ts");
      expect(result).toBeTruthy();
      // Should be able to construct a RegExp from the result
      expect(() => new RegExp(result)).not.toThrow();
    });

    test("alternation output should be valid regex source", () => {
      const result = convertGlobsToRegex("*.test.ts,*.spec.ts");
      expect(result).toBeTruthy();
      // Should be able to construct a RegExp from the result
      expect(() => new RegExp(result)).not.toThrow();
    });

    test("should escape special regex characters in file extensions", () => {
      const result = convertGlobsToRegex("*.test.ts");
      expect(result).toBeTruthy();
      // Dot should be escaped
      expect(result).toContain("\\.ts");
    });
  });

  describe("consistency and determinism", () => {
    test("should return same output for same input", () => {
      const pattern = "*.test.ts,*.spec.ts";
      const result1 = convertGlobsToRegex(pattern);
      const result2 = convertGlobsToRegex(pattern);
      expect(result1).toBe(result2);
    });

    test("should return consistent output regardless of whitespace variations", () => {
      const result1 = convertGlobsToRegex("*.test.ts,*.spec.ts");
      const result2 = convertGlobsToRegex("*.test.ts , *.spec.ts");
      const result3 = convertGlobsToRegex("  *.test.ts  ,  *.spec.ts  ");
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });
  });
});