import { describe, test, expect } from "vitest";
import { validateWorkspaceSlug } from "@/services/workspace";
import { 
  WORKSPACE_ERRORS, 
  RESERVED_WORKSPACE_SLUGS,
  WORKSPACE_SLUG_PATTERNS 
} from "@/lib/constants";

describe("validateWorkspaceSlug", () => {
  describe("Valid slugs", () => {
    test("should accept valid slug with lowercase letters", () => {
      const result = validateWorkspaceSlug("myworkspace");
      expect(result).toEqual({ isValid: true });
    });

    test("should accept valid slug with numbers", () => {
      const result = validateWorkspaceSlug("workspace123");
      expect(result).toEqual({ isValid: true });
    });

    test("should accept valid slug with hyphens in middle", () => {
      const result = validateWorkspaceSlug("my-workspace");
      expect(result).toEqual({ isValid: true });
    });

    test("should accept valid slug with multiple hyphens", () => {
      const result = validateWorkspaceSlug("my-awesome-workspace");
      expect(result).toEqual({ isValid: true });
    });

    test("should accept valid slug with mixed alphanumeric and hyphens", () => {
      const result = validateWorkspaceSlug("test-workspace-123");
      expect(result).toEqual({ isValid: true });
    });

    test("should accept minimum length slug", () => {
      const result = validateWorkspaceSlug("ab");
      expect(result).toEqual({ isValid: true });
    });

    test("should accept maximum length slug", () => {
      const maxLengthSlug = "a".repeat(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH);
      const result = validateWorkspaceSlug(maxLengthSlug);
      expect(result).toEqual({ isValid: true });
    });

    test("should accept single character repeated with hyphens", () => {
      const result = validateWorkspaceSlug("a-b-c-d-e");
      expect(result).toEqual({ isValid: true });
    });
  });

  describe("Invalid length", () => {
    test("should reject slug that is too short (1 character)", () => {
      const result = validateWorkspaceSlug("a");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      });
    });

    test("should reject empty string", () => {
      const result = validateWorkspaceSlug("");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      });
    });

    test("should reject slug that is too long", () => {
      const tooLongSlug = "a".repeat(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH + 1);
      const result = validateWorkspaceSlug(tooLongSlug);
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      });
    });

    test("should reject extremely long slug", () => {
      const veryLongSlug = "a".repeat(100);
      const result = validateWorkspaceSlug(veryLongSlug);
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      });
    });
  });

  describe("Invalid format", () => {
    test("should reject slug with uppercase letters", () => {
      const result = validateWorkspaceSlug("MyWorkspace");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
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

    test("should reject slug with underscores", () => {
      const result = validateWorkspaceSlug("work_space");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with special characters", () => {
      const result = validateWorkspaceSlug("work@space");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with dots", () => {
      const result = validateWorkspaceSlug("work.space");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with spaces", () => {
      const result = validateWorkspaceSlug("work space");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with leading space", () => {
      const result = validateWorkspaceSlug(" workspace");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with trailing space", () => {
      const result = validateWorkspaceSlug("workspace ");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with only hyphens", () => {
      const result = validateWorkspaceSlug("--");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should reject slug with mixed invalid characters", () => {
      const result = validateWorkspaceSlug("work_space@123!");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });
  });

  describe("Reserved slugs", () => {
    test("should reject 'api' (reserved system route)", () => {
      const result = validateWorkspaceSlug("api");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED
      });
    });

    test("should reject 'admin' (reserved system route)", () => {
      const result = validateWorkspaceSlug("admin");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED
      });
    });

    test("should reject 'dashboard' (reserved system route)", () => {
      const result = validateWorkspaceSlug("dashboard");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED
      });
    });

    test("should reject 'auth' (reserved authentication route)", () => {
      const result = validateWorkspaceSlug("auth");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED
      });
    });

    test("should reject 'help' (reserved help route)", () => {
      const result = validateWorkspaceSlug("help");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED
      });
    });

    test("should reject 'www' (reserved infrastructure)", () => {
      const result = validateWorkspaceSlug("www");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED
      });
    });

    test("should reject 'test' (reserved environment)", () => {
      const result = validateWorkspaceSlug("test");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED
      });
    });

    test("should reject 'production' (reserved environment)", () => {
      const result = validateWorkspaceSlug("production");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED
      });
    });

    test("should reject 'workspaces' (reserved app route)", () => {
      const result = validateWorkspaceSlug("workspaces");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED
      });
    });

    test("should reject 'stakgraph' (reserved app-specific)", () => {
      const result = validateWorkspaceSlug("stakgraph");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED
      });
    });

    test("should reject 'robots' (reserved technical)", () => {
      const result = validateWorkspaceSlug("robots");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED
      });
    });

    test("should reject all reserved slugs from the list", () => {
      // Test a sampling of reserved slugs to ensure the validation works
      const sampleReservedSlugs = [
        "login", "logout", "signup", "register", "signin", "signout",
        "settings", "onboarding", "support", "docs", "documentation",
        "contact", "mail", "email", "blog", "news", "status", "health",
        "graphql", "webhook", "callback", "oauth", "cdn", "assets",
        "staging", "dev", "development", "preview", "demo", "user",
        "users", "profile", "account", "billing", "subscription",
        "pricing", "features", "roadmap", "tasks", "projects",
        "repositories", "repos", "code-graph", "swarm", "pool-manager"
      ];

      for (const reservedSlug of sampleReservedSlugs) {
        const result = validateWorkspaceSlug(reservedSlug);
        expect(result).toEqual({
          isValid: false,
          error: WORKSPACE_ERRORS.SLUG_RESERVED
        });
      }
    });
  });

  describe("Edge cases", () => {
    test("should handle null input gracefully", () => {
      // TypeScript would prevent this, but JavaScript might pass null
      const result = validateWorkspaceSlug(null as any);
      expect(result.isValid).toBe(false);
    });

    test("should handle undefined input gracefully", () => {
      // TypeScript would prevent this, but JavaScript might pass undefined
      const result = validateWorkspaceSlug(undefined as any);
      expect(result.isValid).toBe(false);
    });

    test("should handle numeric input as string", () => {
      const result = validateWorkspaceSlug("123");
      expect(result).toEqual({ isValid: true });
    });

    test("should handle slug at exact min length boundary", () => {
      const minLengthSlug = "ab"; // exactly MIN_LENGTH characters
      const result = validateWorkspaceSlug(minLengthSlug);
      expect(result).toEqual({ isValid: true });
    });

    test("should handle slug at exact max length boundary", () => {
      const maxLengthSlug = "a".repeat(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH);
      const result = validateWorkspaceSlug(maxLengthSlug);
      expect(result).toEqual({ isValid: true });
    });

    test("should handle slug one character over max length", () => {
      const overMaxSlug = "a".repeat(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH + 1);
      const result = validateWorkspaceSlug(overMaxSlug);
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      });
    });

    test("should handle slug one character under min length", () => {
      const underMinSlug = "a"; // one less than MIN_LENGTH
      const result = validateWorkspaceSlug(underMinSlug);
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      });
    });

    test("should prioritize length validation over format validation", () => {
      // Test that length is checked first - invalid length with also invalid format
      const result = validateWorkspaceSlug("A"); // too short AND uppercase
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH
      });
    });

    test("should prioritize format validation over reserved slug validation", () => {
      // Test with an invalid format that happens to match a reserved word pattern
      const result = validateWorkspaceSlug("API"); // reserved word but uppercase (invalid format)
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should handle whitespace-only input", () => {
      const result = validateWorkspaceSlug("   ");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should handle tab characters", () => {
      const result = validateWorkspaceSlug("work\tspace");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });

    test("should handle newline characters", () => {
      const result = validateWorkspaceSlug("work\nspace");
      expect(result).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT
      });
    });
  });
});
