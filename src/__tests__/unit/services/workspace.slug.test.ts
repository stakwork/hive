import { describe, test, expect } from "vitest";
import { validateWorkspaceSlug } from "@/services/workspace";
import { WORKSPACE_ERRORS } from "@/lib/constants";

describe("Workspace Slug Validation", () => {
  describe("validateWorkspaceSlug", () => {
    test("should accept valid slugs", () => {
      expect(validateWorkspaceSlug("my-workspace")).toEqual({ isValid: true });
      expect(validateWorkspaceSlug("workspace123")).toEqual({ isValid: true });
      expect(validateWorkspaceSlug("a1")).toEqual({ isValid: true });
      expect(validateWorkspaceSlug("test-workspace-123")).toEqual({ isValid: true });
    });

    test("should reject slugs that are too short", () => {
      expect(validateWorkspaceSlug("a")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH,
      });
    });

    test("should reject slugs that are too long", () => {
      const longSlug = "a".repeat(51);
      expect(validateWorkspaceSlug(longSlug)).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_LENGTH,
      });
    });

    test("should reject invalid format slugs", () => {
      expect(validateWorkspaceSlug("-invalid")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT,
      });
      expect(validateWorkspaceSlug("invalid-")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT,
      });
      expect(validateWorkspaceSlug("Invalid-Caps")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_INVALID_FORMAT,
      });
    });

    test("should accept slugs with underscores", () => {
      expect(validateWorkspaceSlug("valid_underscore")).toEqual({ isValid: true });
      expect(validateWorkspaceSlug("senza_android")).toEqual({ isValid: true });
      expect(validateWorkspaceSlug("my_workspace_123")).toEqual({ isValid: true });
    });

    test("should reject reserved slugs", () => {
      expect(validateWorkspaceSlug("admin")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED,
      });
      expect(validateWorkspaceSlug("api")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED,
      });
      expect(validateWorkspaceSlug("dashboard")).toEqual({
        isValid: false,
        error: WORKSPACE_ERRORS.SLUG_RESERVED,
      });
    });
  });
});
