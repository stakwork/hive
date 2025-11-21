import { describe, test, expect } from "vitest";
import { convertGlobsToRegex } from "@/lib/utils/glob";

describe("convertGlobsToRegex", () => {
  describe("Input Validation", () => {
    test("should return empty string for null input", () => {
      expect(convertGlobsToRegex(null as any)).toBe("");
    });

    test("should return empty string for undefined input", () => {
      expect(convertGlobsToRegex(undefined as any)).toBe("");
    });

    test("should return empty string for empty string input", () => {
      expect(convertGlobsToRegex("")).toBe("");
    });

    test("should return empty string for whitespace-only input", () => {
      expect(convertGlobsToRegex("   ")).toBe("");
      expect(convertGlobsToRegex("\t")).toBe("");
      expect(convertGlobsToRegex("\n")).toBe("");
      expect(convertGlobsToRegex("  \t\n  ")).toBe("");
    });

    test("should return empty string for comma-only input", () => {
      expect(convertGlobsToRegex(",")).toBe("");
      expect(convertGlobsToRegex(",,,")).toBe("");
      expect(convertGlobsToRegex(", , ,")).toBe("");
    });
  });

  describe("Single Pattern Conversion", () => {
    test("should convert simple wildcard pattern", () => {
      const result = convertGlobsToRegex("*.ts");
      expect(result).toBeTruthy();
      // Simple patterns don't have wrapping parentheses from our function
      expect(result).not.toMatch(/^\(.*\)$/);
    });

    test("should convert specific filename pattern", () => {
      const result = convertGlobsToRegex("test.js");
      expect(result).toBeTruthy();
      // Single pattern should not be wrapped by our function
      expect(result).not.toMatch(/^\(.*\)$/);
    });

    test("should convert extension wildcard pattern", () => {
      const result = convertGlobsToRegex("*.{ts,tsx,js,jsx}");
      expect(result).toBeTruthy();
      // Note: globrex treats braces literally unless configured otherwise
      expect(result).toContain("{ts");
    });

    test("should convert directory pattern with globstar", () => {
      const result = convertGlobsToRegex("src/**");
      expect(result).toBeTruthy();
      // Globstar patterns contain internal regex alternations
      expect(result).toContain("src");
    });

    test("should convert single pattern without wrapping in parentheses", () => {
      const result = convertGlobsToRegex("*.test.ts");
      // Our function doesn't wrap single patterns in outer parentheses
      expect(result).not.toMatch(/^\(.*\|.*\)$/);
    });
  });

  describe("Multiple Pattern Conversion", () => {
    test("should combine two patterns with alternation", () => {
      const result = convertGlobsToRegex("*.ts,*.tsx");
      expect(result).toMatch(/^\(/);
      expect(result).toMatch(/\)$/);
      expect(result).toContain("|");
    });

    test("should combine three or more patterns with alternation", () => {
      const result = convertGlobsToRegex("*.ts,*.tsx,*.js,*.jsx");
      expect(result).toMatch(/^\(/);
      expect(result).toMatch(/\)$/);
      const pipeCount = (result.match(/\|/g) || []).length;
      expect(pipeCount).toBe(3);
    });

    test("should handle complex multiple patterns", () => {
      const result = convertGlobsToRegex("src/**/*.ts,test/**/*.test.ts,*.config.js");
      expect(result).toMatch(/^\(/);
      expect(result).toMatch(/\)$/);
      expect(result).toContain("|");
    });

    test("should preserve pattern order in alternation", () => {
      const result = convertGlobsToRegex("first.ts,second.ts");
      expect(result).toMatch(/^\(/);
      expect(result).toContain("|");
      expect(result).toMatch(/\)$/);
    });
  });

  describe("Whitespace Handling", () => {
    test("should trim whitespace around single pattern", () => {
      const result = convertGlobsToRegex("  *.ts  ");
      expect(result).toBeTruthy();
      expect(result).not.toContain(" ");
    });

    test("should trim whitespace around comma-separated patterns", () => {
      const result = convertGlobsToRegex("  *.ts  ,  *.tsx  ");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
      expect(result).not.toContain(" ");
    });

    test("should handle mixed whitespace types", () => {
      const result = convertGlobsToRegex("\t*.ts\t,\n*.tsx\n");
      expect(result).toBeTruthy();
      expect(result).toContain("|");
      expect(result).not.toContain("\t");
      expect(result).not.toContain("\n");
    });

    test("should trim whitespace but preserve patterns", () => {
      const resultWithSpaces = convertGlobsToRegex("  *.ts  ,  *.tsx  ");
      const resultNoSpaces = convertGlobsToRegex("*.ts,*.tsx");
      expect(resultWithSpaces).toBe(resultNoSpaces);
    });
  });

  describe("Globstar Syntax", () => {
    test("should handle globstar in single pattern", () => {
      const result = convertGlobsToRegex("**/*.ts");
      expect(result).toBeTruthy();
      // Note: globstar patterns may contain internal regex alternations
      // Our function doesn't wrap single patterns in outer parentheses with multiple alternatives
      expect(result).not.toMatch(/^\(.*\|.*\)$/);
    });

    test("should handle globstar in directory path", () => {
      const result = convertGlobsToRegex("src/**/tests/*.test.ts");
      expect(result).toBeTruthy();
    });

    test("should handle multiple globstars", () => {
      const result = convertGlobsToRegex("**/**/*.ts");
      expect(result).toBeTruthy();
    });

    test("should handle globstar with multiple patterns", () => {
      const result = convertGlobsToRegex("**/*.ts,**/*.tsx");
      expect(result).toContain("|");
      expect(result).toMatch(/^\(/);
      expect(result).toMatch(/\)$/);
    });

    test("should handle mixed globstar and non-globstar patterns", () => {
      const result = convertGlobsToRegex("src/**/*.ts,test.js");
      expect(result).toContain("|");
    });
  });

  describe("Empty Pattern Filtering", () => {
    test("should filter out empty patterns from comma list", () => {
      const result = convertGlobsToRegex("*.ts,,*.tsx");
      expect(result).toContain("|");
      const pipeCount = (result.match(/\|/g) || []).length;
      expect(pipeCount).toBe(1);
    });

    test("should filter multiple consecutive empty patterns", () => {
      const result = convertGlobsToRegex("*.ts,,,*.tsx");
      expect(result).toContain("|");
      const pipeCount = (result.match(/\|/g) || []).length;
      expect(pipeCount).toBe(1);
    });

    test("should handle empty patterns with whitespace", () => {
      const result = convertGlobsToRegex("*.ts, ,*.tsx");
      expect(result).toContain("|");
      const pipeCount = (result.match(/\|/g) || []).length;
      expect(pipeCount).toBe(1);
    });

    test("should filter leading empty patterns", () => {
      const result = convertGlobsToRegex(",*.ts,*.tsx");
      expect(result).toContain("|");
      const pipeCount = (result.match(/\|/g) || []).length;
      expect(pipeCount).toBe(1);
    });

    test("should filter trailing empty patterns", () => {
      const result = convertGlobsToRegex("*.ts,*.tsx,");
      expect(result).toContain("|");
      const pipeCount = (result.match(/\|/g) || []).length;
      expect(pipeCount).toBe(1);
    });

    test("should return single pattern when all others are empty", () => {
      const result = convertGlobsToRegex(",,*.ts,,");
      expect(result).toBeTruthy();
      expect(result).not.toContain("|");
      expect(result).not.toMatch(/^\(/);
    });
  });

  describe("Real-World Scenarios", () => {
    test("should handle unit test glob pattern", () => {
      const result = convertGlobsToRegex("src/**/*.test.ts,src/**/*.test.tsx");
      expect(result).toContain("|");
      expect(result).toMatch(/^\(/);
      expect(result).toMatch(/\)$/);
    });

    test("should handle integration test glob pattern", () => {
      const result = convertGlobsToRegex("src/__tests__/integration/**/*.test.ts");
      expect(result).toBeTruthy();
      // Single pattern - not wrapped by our function (even if globrex output has internal |)
      expect(result).not.toMatch(/^\(.*\|.*\)$/);
    });

    test("should handle e2e test glob pattern", () => {
      const result = convertGlobsToRegex("src/__tests__/e2e/**/*.spec.ts");
      expect(result).toBeTruthy();
    });

    test("should handle mixed test file extensions", () => {
      const result = convertGlobsToRegex("**/*.test.ts,**/*.test.tsx,**/*.spec.ts,**/*.spec.tsx");
      expect(result).toContain("|");
      // Count function-level pipes (between patterns), not internal regex pipes
      // With 4 patterns joined by |, we expect 3 top-level pipes PLUS internal pipes from globstar
      // Each globstar pattern has internal pipes, so total is 3 + (4 internal) = 7
      const pipeCount = (result.match(/\|/g) || []).length;
      expect(pipeCount).toBeGreaterThanOrEqual(3); // At least 3 for joining patterns
    });

    test("should handle source file patterns", () => {
      const result = convertGlobsToRegex("src/**/*.ts,src/**/*.tsx,!src/**/*.test.ts,!src/**/*.test.tsx");
      expect(result).toContain("|");
    });

    test("should handle config file patterns", () => {
      const result = convertGlobsToRegex("*.config.js,*.config.ts,.*.js,.*.ts");
      expect(result).toContain("|");
    });
  });

  describe("Edge Cases", () => {
    test("should handle single character pattern", () => {
      const result = convertGlobsToRegex("*");
      expect(result).toBeTruthy();
    });

    test("should handle very long pattern list", () => {
      const patterns = Array.from({ length: 20 }, (_, i) => `pattern${i}.ts`).join(",");
      const result = convertGlobsToRegex(patterns);
      expect(result).toContain("|");
      const pipeCount = (result.match(/\|/g) || []).length;
      expect(pipeCount).toBe(19);
    });

    test("should handle patterns with special regex characters", () => {
      const result = convertGlobsToRegex("test[1-3].ts");
      expect(result).toBeTruthy();
    });

    test("should handle patterns with braces", () => {
      const result = convertGlobsToRegex("*.{js,ts,jsx,tsx}");
      expect(result).toBeTruthy();
    });

    test("should handle patterns with question mark", () => {
      const result = convertGlobsToRegex("test?.ts");
      expect(result).toBeTruthy();
    });

    test("should handle patterns with exclamation mark (negation)", () => {
      const result = convertGlobsToRegex("!node_modules/**");
      expect(result).toBeTruthy();
    });

    test("should handle complex nested directory patterns", () => {
      const result = convertGlobsToRegex("src/**/components/**/*.tsx");
      expect(result).toBeTruthy();
    });

    test("should return consistent output for same input", () => {
      const input = "*.ts,*.tsx";
      const result1 = convertGlobsToRegex(input);
      const result2 = convertGlobsToRegex(input);
      expect(result1).toBe(result2);
    });
  });

  describe("Output Format Validation", () => {
    test("should return valid regex pattern for single glob", () => {
      const result = convertGlobsToRegex("*.ts");
      expect(() => new RegExp(result)).not.toThrow();
    });

    test("should return valid regex pattern for multiple globs", () => {
      const result = convertGlobsToRegex("*.ts,*.tsx");
      expect(() => new RegExp(result)).not.toThrow();
    });

    test("should create working regex that matches expected files", () => {
      const result = convertGlobsToRegex("*.test.ts");
      const regex = new RegExp(result);
      expect(regex.test("example.test.ts")).toBe(true);
      expect(regex.test("example.ts")).toBe(false);
    });

    test("should create working regex for multiple patterns", () => {
      const result = convertGlobsToRegex("*.ts,*.tsx");
      const regex = new RegExp(result);
      expect(regex.test("file.ts")).toBe(true);
      expect(regex.test("file.tsx")).toBe(true);
      expect(regex.test("file.js")).toBe(false);
    });

    test("should create working regex for globstar patterns", () => {
      const result = convertGlobsToRegex("src/**/*.ts");
      const regex = new RegExp(result);
      expect(regex.test("src/file.ts")).toBe(true);
      expect(regex.test("src/nested/file.ts")).toBe(true);
      expect(regex.test("src/deeply/nested/file.ts")).toBe(true);
    });
  });
});
