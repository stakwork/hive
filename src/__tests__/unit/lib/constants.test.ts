import { describe, it, expect } from "vitest";
import {
  getSwarmVanityAddress,
  RESERVED_WORKSPACE_SLUGS,
  WORKSPACE_SLUG_PATTERNS,
  WORKSPACE_PERMISSION_LEVELS,
  WORKSPACE_LIMITS,
} from "@/lib/constants";
import { WorkspaceRole } from "@prisma/client";

describe("constants", () => {
  describe("getSwarmVanityAddress", () => {
    it("should format vanity address correctly", () => {
      const result = getSwarmVanityAddress("myswarm");
      expect(result).toBe("myswarm.sphinx.chat");
    });

    it("should handle names with hyphens", () => {
      const result = getSwarmVanityAddress("my-swarm");
      expect(result).toBe("my-swarm.sphinx.chat");
    });

    it("should handle names with numbers", () => {
      const result = getSwarmVanityAddress("swarm123");
      expect(result).toBe("swarm123.sphinx.chat");
    });

    it("should handle single character names", () => {
      const result = getSwarmVanityAddress("x");
      expect(result).toBe("x.sphinx.chat");
    });

    it("should handle empty string", () => {
      const result = getSwarmVanityAddress("");
      expect(result).toBe(".sphinx.chat");
    });

    it("should handle names with special characters", () => {
      const result = getSwarmVanityAddress("test_swarm");
      expect(result).toBe("test_swarm.sphinx.chat");
    });
  });

  describe("RESERVED_WORKSPACE_SLUGS", () => {
    it("should contain system routes", () => {
      expect(RESERVED_WORKSPACE_SLUGS).toContain("api");
      expect(RESERVED_WORKSPACE_SLUGS).toContain("admin");
      expect(RESERVED_WORKSPACE_SLUGS).toContain("dashboard");
      expect(RESERVED_WORKSPACE_SLUGS).toContain("auth");
    });

    it("should contain authentication routes", () => {
      expect(RESERVED_WORKSPACE_SLUGS).toContain("login");
      expect(RESERVED_WORKSPACE_SLUGS).toContain("logout");
      expect(RESERVED_WORKSPACE_SLUGS).toContain("signup");
      expect(RESERVED_WORKSPACE_SLUGS).toContain("signin");
    });

    it("should contain help and support routes", () => {
      expect(RESERVED_WORKSPACE_SLUGS).toContain("help");
      expect(RESERVED_WORKSPACE_SLUGS).toContain("support");
      expect(RESERVED_WORKSPACE_SLUGS).toContain("docs");
    });

    it("should be an array", () => {
      expect(Array.isArray(RESERVED_WORKSPACE_SLUGS)).toBe(true);
    });

    it("should contain more than 50 reserved slugs", () => {
      expect(RESERVED_WORKSPACE_SLUGS.length).toBeGreaterThan(50);
    });
  });

  describe("WORKSPACE_SLUG_PATTERNS", () => {
    it("should have valid regex pattern", () => {
      expect(WORKSPACE_SLUG_PATTERNS.VALID).toBeInstanceOf(RegExp);
    });

    it("should validate correct slug formats", () => {
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("valid-slug")).toBe(true);
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("myworkspace")).toBe(true);
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("work123")).toBe(true);
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("my-work-space")).toBe(true);
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("senza_android")).toBe(true);
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("my_workspace")).toBe(true);
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("test_123")).toBe(true);
    });

    it("should reject invalid slug formats", () => {
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("-invalid")).toBe(false);
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("invalid-")).toBe(false);
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("Invalid")).toBe(false);
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("_invalid")).toBe(false);
      expect(WORKSPACE_SLUG_PATTERNS.VALID.test("invalid_")).toBe(false);
    });

    it("should have min length of 2", () => {
      expect(WORKSPACE_SLUG_PATTERNS.MIN_LENGTH).toBe(2);
    });

    it("should have max length of 50", () => {
      expect(WORKSPACE_SLUG_PATTERNS.MAX_LENGTH).toBe(50);
    });
  });

  describe("WORKSPACE_PERMISSION_LEVELS", () => {
    it("should map all WorkspaceRole values", () => {
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.VIEWER]).toBe(0);
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.STAKEHOLDER]).toBe(1);
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]).toBe(2);
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.PM]).toBe(3);
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.ADMIN]).toBe(4);
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.OWNER]).toBe(5);
    });

    it("should have ascending permission levels", () => {
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.VIEWER]).toBeLessThan(
        WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.STAKEHOLDER]
      );
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.STAKEHOLDER]).toBeLessThan(
        WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]
      );
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]).toBeLessThan(
        WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.PM]
      );
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.PM]).toBeLessThan(
        WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.ADMIN]
      );
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.ADMIN]).toBeLessThan(
        WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.OWNER]
      );
    });

    it("should have OWNER as highest permission level", () => {
      const maxLevel = Math.max(...Object.values(WORKSPACE_PERMISSION_LEVELS));
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.OWNER]).toBe(maxLevel);
    });

    it("should have VIEWER as lowest permission level", () => {
      const minLevel = Math.min(...Object.values(WORKSPACE_PERMISSION_LEVELS));
      expect(WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.VIEWER]).toBe(minLevel);
    });
  });

  describe("WORKSPACE_LIMITS", () => {
    it("should have MAX_WORKSPACES_PER_USER defined", () => {
      expect(WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER).toBeDefined();
      expect(typeof WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER).toBe("number");
    });

    it("should have positive limit", () => {
      expect(WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER).toBeGreaterThan(0);
    });
  });
});
