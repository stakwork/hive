import { describe, test, expect } from "vitest";
import { validateWorkspaceSlug } from "@/services/workspace";
import { 
  WORKSPACE_ERRORS,
  WORKSPACE_SLUG_PATTERNS,
  RESERVED_WORKSPACE_SLUGS 
} from "@/lib/constants";

describe("validateWorkspaceSlug", () => {
  describe("valid slugs", () => {
    test("should accept valid lowercase alphanumeric slug", () => {
      const result = validateWorkspaceSlug("myworkspace");
      expect(result).toEqual({ isValid: true });
    });

    test("should accept valid slug with hyphens", () => {
      const result = validateWorkspaceSlug("my-workspace");
      expect(result).toEqual({ isValid: true });
    });

    test("should accept valid slug with numbers", () => {
      const result = validateWorkspaceSlug("workspace123");
      expect(result).toEqual({ isValid: true });
    });

    test("should accept valid slug with mixed alphanumeric and hyphens", () => {
      const result = validateWorkspaceSlug("my-workspace-123");
      expect(result).toEqual({ isValid: true });
    });

    test("should accept minimum length slug", () => {
      const minLengthSlug = "ab";
      expect(minLengthSlug.length).toBe(WORKSPACE_SLUG_PATTERNS.MIN_LENGTH);
      const result = validateWorkspaceSlug(minLengthSlug);
      expect(result).toEqual({ isValid: true });
    });

    test("should accept maximum length slug", () => {
      const maxLengthSlug = "a".repeat(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH);
      expect(maxLengthSlug.length).toBe(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH);
      const result = validateWorkspaceSlug(maxLengthSlug);
      expect(result).toEqual({ isValid: true });
    });

    test("should accept slug starting and ending with numbers", () => {
      const result = validateWorkspaceSlug("123-workspace-456");
      expect(result).toEqual({ isValid: true });
    });
  });

  describe("invalid slug length", () => {
    test("should reject slug shorter than minimum length", () => {
      const shortSlug = "a";
      expect(shortSlug.length).toBeLessThan(WORKSPACE_SLUG_PATTERNS.MIN_LENGTH);
      const result = validateWorkspaceSlug(shortSlug);
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      });
    });

    test("should reject empty slug", () => {
      const result = validateWorkspaceSlug("");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      });
    });

    test("should reject slug longer than maximum length", () => {
      const longSlug = "a".repeat(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH + 1);
      expect(longSlug.length).toBeGreaterThan(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH);
      const result = validateWorkspaceSlug(longSlug);
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      });
    });
  });

  describe("invalid slug format", () => {
    test("should reject slug with uppercase letters", () => {
      const result = validateWorkspaceSlug("MyWorkspace");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with underscores", () => {
      const result = validateWorkspaceSlug("my_workspace");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with spaces", () => {
      const result = validateWorkspaceSlug("my workspace");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with special characters", () => {
      const specialChars = ["@", "#", "$", "%", "^", "&", "*", "(", ")", "+", "=", "{", "}", "[", "]", "|", "\\", ":", ";", '"', "'", "<", ">", "?", "/", ".", ","];
      
      for (const char of specialChars) {
        const result = validateWorkspaceSlug(`test${char}workspace`);
        expect(result).toEqual({
          isValid: false,
          error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
        });
      }
    });

    test("should reject slug starting with hyphen", () => {
      const result = validateWorkspaceSlug("-workspace");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug ending with hyphen", () => {
      const result = validateWorkspaceSlug("workspace-");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with consecutive hyphens", () => {
      const result = validateWorkspaceSlug("work--space");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with only hyphens", () => {
      const result = validateWorkspaceSlug("---");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with unicode characters", () => {
      const result = validateWorkspaceSlug("wörκspace");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });
  });

  describe("reserved slugs", () => {
    test("should reject system route slugs", () => {
      const systemSlugs = ["api", "admin", "dashboard", "settings", "auth"];
      
      for (const slug of systemSlugs) {
        const result = validateWorkspaceSlug(slug);
        expect(result).toEqual({
          isValid: false,
          error: WORKSPACE_ERRORS.SLUG_RESERVED
        });
      }
    });

    test("should reject authentication route slugs", () => {
      const authSlugs = ["login", "logout", "signup", "register", "signin", "signout"];
      
      for (const slug of authSlugs) {
        const result = validateWorkspaceSlug(slug);
        expect(result).toEqual({
          isValid: false,
          error: WORKSPACE_ERRORS.SLUG_RESERVED
        });
      }
    });

    test("should reject help and support route slugs", () => {
      const helpSlugs = ["help", "support", "docs", "documentation", "faq", "contact"];
      
      for (const slug of helpSlugs) {
        const result = validateWorkspaceSlug(slug);
        expect(result).toEqual({
          isValid: false,
          error: WORKSPACE_ERRORS.SLUG_RESERVED
        });
      }
    });

    test("should reject infrastructure route slugs", () => {
      const infraSlugs = ["www", "mail", "email", "blog", "cdn", "assets", "static"];
      
      for (const slug of infraSlugs) {
        const result = validateWorkspaceSlug(slug);
        expect(result).toEqual({
          isValid: false,
          error: WORKSPACE_ERRORS.SLUG_RESERVED
        });
      }
    });

    test("should reject environment route slugs", () => {
      const envSlugs = ["test", "testing", "staging", "prod", "production", "dev", "development"];
      
      for (const slug of envSlugs) {
        const result = validateWorkspaceSlug(slug);
        expect(result).toEqual({
          isValid: false,
          error: WORKSPACE_ERRORS.SLUG_RESERVED
        });
      }
    });

    test("should reject app-specific route slugs", () => {
      const appSlugs = ["workspaces", "workspace", "user", "users", "profile", "account"];
      
      for (const slug of appSlugs) {
        const result = validateWorkspaceSlug(slug);
        expect(result).toEqual({
          isValid: false,
          error: WORKSPACE_ERRORS.SLUG_RESERVED
        });
      }
    });

    test("should reject all reserved slugs from constants", () => {
      // Test a sample of reserved slugs to ensure they're properly rejected
      for (const slug of RESERVED_WORKSPACE_SLUGS.slice(0, 10)) {
        const result = validateWorkspaceSlug(slug);
        expect(result).toEqual({
          isValid: false,
          error: WORKSPACE_ERRORS.SLUG_RESERVED
        });
      }
    });
  });

  describe("edge cases", () => {
    test("should handle null input gracefully", () => {
      const result = validateWorkspaceSlug(null as any);
      expect(result.isValid).toBe(false);
    });

    test("should handle undefined input gracefully", () => {
      const result = validateWorkspaceSlug(undefined as any);
      expect(result.isValid).toBe(false);
    });

    test("should handle numeric input", () => {
      const result = validateWorkspaceSlug(123 as any);
      expect(result.isValid).toBe(false);
    });

    test("should handle object input", () => {
      const result = validateWorkspaceSlug({} as any);
      expect(result.isValid).toBe(false);
    });

    test("should handle array input", () => {
      const result = validateWorkspaceSlug([] as any);
      expect(result.isValid).toBe(false);
    });

    test("should be case sensitive for reserved words", () => {
      // Uppercase versions of reserved words should be invalid due to format rules, not reserved rules
      const result = validateWorkspaceSlug("API");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should validate exact boundary values", () => {
      // Test exactly at boundaries
      const exactMinLength = "ab"; // exactly 2 chars
      const exactMaxLength = "a".repeat(50); // exactly 50 chars
      
      expect(validateWorkspaceSlug(exactMinLength)).toEqual({ isValid: true });
      expect(validateWorkspaceSlug(exactMaxLength)).toEqual({ isValid: true });
    });

    test("should validate regex pattern boundary cases", () => {
      // Test edge cases for the regex pattern
      expect(validateWorkspaceSlug("a1")).toEqual({ isValid: true }); // min length with mixed
      expect(validateWorkspaceSlug("1a")).toEqual({ isValid: true }); // starts with number
      expect(validateWorkspaceSlug("a-1")).toEqual({ isValid: true }); // mixed with hyphen
      expect(validateWorkspaceSlug("1-a")).toEqual({ isValid: true }); // starts with number, has hyphen
    });
  });

  describe("performance considerations", () => {
    test("should handle very long invalid slugs efficiently", () => {
      const veryLongSlug = "a".repeat(1000);
      const start = performance.now();
      const result = validateWorkspaceSlug(veryLongSlug);
      const end = performance.now();
      
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(WORKSPACE_ERRORS.SLUG_INVALID_LENGTH);
      expect(end - start).toBeLessThan(100); // Should complete in under 100ms
    });

    test("should handle regex validation efficiently", () => {
      const complexSlug = "a1-b2-c3-d4-e5";
      const start = performance.now();
      const result = validateWorkspaceSlug(complexSlug);
      const end = performance.now();
      
      expect(result.isValid).toBe(true);
      expect(end - start).toBeLessThan(50); // Should complete in under 50ms
    });
  });
});