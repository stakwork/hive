import { describe, it, expect } from "vitest";
import { WorkspaceRole } from "@prisma/client";
import {
  isWorkspaceRole,
  isAssignableMemberRole,
  AssignableMemberRoles,
  RoleLabels,
  RoleHierarchy,
  hasRoleLevel,
  WorkspaceRoleSchema,
  AssignableMemberRoleSchema,
} from "@/lib/auth/roles";

describe("Role Validation Helpers", () => {
  describe("isWorkspaceRole", () => {
    it("should return true for all valid WorkspaceRole values", () => {
      Object.values(WorkspaceRole).forEach((role) => {
        expect(isWorkspaceRole(role)).toBe(true);
      });
    });

    it("should return false for invalid values", () => {
      expect(isWorkspaceRole("INVALID_ROLE")).toBe(false);
      expect(isWorkspaceRole("")).toBe(false);
      expect(isWorkspaceRole(null)).toBe(false);
      expect(isWorkspaceRole(undefined)).toBe(false);
      expect(isWorkspaceRole(123)).toBe(false);
      expect(isWorkspaceRole({})).toBe(false);
    });
  });

  describe("isAssignableMemberRole", () => {
    it("should return true for assignable roles", () => {
      expect(isAssignableMemberRole(WorkspaceRole.VIEWER)).toBe(true);
      expect(isAssignableMemberRole(WorkspaceRole.DEVELOPER)).toBe(true);
      expect(isAssignableMemberRole(WorkspaceRole.PM)).toBe(true);
      expect(isAssignableMemberRole(WorkspaceRole.ADMIN)).toBe(true);
    });

    it("should return false for non-assignable roles", () => {
      expect(isAssignableMemberRole(WorkspaceRole.OWNER)).toBe(false);
      expect(isAssignableMemberRole(WorkspaceRole.STAKEHOLDER)).toBe(false);
    });

    it("should return false for invalid values", () => {
      expect(isAssignableMemberRole("INVALID_ROLE")).toBe(false);
      expect(isAssignableMemberRole("")).toBe(false);
      expect(isAssignableMemberRole(null)).toBe(false);
      expect(isAssignableMemberRole(undefined)).toBe(false);
      expect(isAssignableMemberRole(123)).toBe(false);
    });
  });

  describe("AssignableMemberRoles", () => {
    it("should contain exactly the expected assignable roles", () => {
      expect(AssignableMemberRoles).toEqual([
        WorkspaceRole.VIEWER,
        WorkspaceRole.DEVELOPER,
        WorkspaceRole.PM,
        WorkspaceRole.ADMIN,
      ]);
    });

    it("should not contain OWNER or STAKEHOLDER", () => {
      expect(AssignableMemberRoles).not.toContain(WorkspaceRole.OWNER);
      expect(AssignableMemberRoles).not.toContain(WorkspaceRole.STAKEHOLDER);
    });
  });

  describe("RoleLabels", () => {
    it("should have labels for all WorkspaceRole values", () => {
      Object.values(WorkspaceRole).forEach((role) => {
        expect(RoleLabels[role]).toBeDefined();
        expect(typeof RoleLabels[role]).toBe("string");
        expect(RoleLabels[role].length).toBeGreaterThan(0);
      });
    });

    it("should have correct label mappings", () => {
      expect(RoleLabels[WorkspaceRole.OWNER]).toBe("Owner");
      expect(RoleLabels[WorkspaceRole.ADMIN]).toBe("Admin");
      expect(RoleLabels[WorkspaceRole.PM]).toBe("Product Manager");
      expect(RoleLabels[WorkspaceRole.DEVELOPER]).toBe("Developer");
      expect(RoleLabels[WorkspaceRole.STAKEHOLDER]).toBe("Stakeholder");
      expect(RoleLabels[WorkspaceRole.VIEWER]).toBe("Viewer");
    });
  });

  describe("RoleHierarchy", () => {
    it("should have hierarchy values for all WorkspaceRole values", () => {
      Object.values(WorkspaceRole).forEach((role) => {
        expect(RoleHierarchy[role]).toBeDefined();
        expect(typeof RoleHierarchy[role]).toBe("number");
        expect(RoleHierarchy[role]).toBeGreaterThan(0);
      });
    });

    it("should have correct hierarchy order", () => {
      expect(RoleHierarchy[WorkspaceRole.VIEWER]).toBe(1);
      expect(RoleHierarchy[WorkspaceRole.STAKEHOLDER]).toBe(2);
      expect(RoleHierarchy[WorkspaceRole.DEVELOPER]).toBe(3);
      expect(RoleHierarchy[WorkspaceRole.PM]).toBe(4);
      expect(RoleHierarchy[WorkspaceRole.ADMIN]).toBe(5);
      expect(RoleHierarchy[WorkspaceRole.OWNER]).toBe(6);
    });

    it("should have unique hierarchy values", () => {
      const hierarchyValues = Object.values(RoleHierarchy);
      const uniqueValues = [...new Set(hierarchyValues)];
      expect(hierarchyValues).toHaveLength(uniqueValues.length);
    });
  });

  describe("hasRoleLevel", () => {
    it("should return true when user role has higher or equal level", () => {
      expect(hasRoleLevel(WorkspaceRole.ADMIN, WorkspaceRole.VIEWER)).toBe(true);
      expect(hasRoleLevel(WorkspaceRole.ADMIN, WorkspaceRole.ADMIN)).toBe(true);
      expect(hasRoleLevel(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)).toBe(true);
      expect(hasRoleLevel(WorkspaceRole.PM, WorkspaceRole.DEVELOPER)).toBe(true);
    });

    it("should return false when user role has lower level", () => {
      expect(hasRoleLevel(WorkspaceRole.VIEWER, WorkspaceRole.ADMIN)).toBe(false);
      expect(hasRoleLevel(WorkspaceRole.DEVELOPER, WorkspaceRole.PM)).toBe(false);
      expect(hasRoleLevel(WorkspaceRole.ADMIN, WorkspaceRole.OWNER)).toBe(false);
    });
  });

  describe("Zod Schemas", () => {
    describe("WorkspaceRoleSchema", () => {
      it("should validate all WorkspaceRole values", () => {
        Object.values(WorkspaceRole).forEach((role) => {
          expect(() => WorkspaceRoleSchema.parse(role)).not.toThrow();
        });
      });

      it("should reject invalid values", () => {
        expect(() => WorkspaceRoleSchema.parse("INVALID_ROLE")).toThrow();
        expect(() => WorkspaceRoleSchema.parse("")).toThrow();
        expect(() => WorkspaceRoleSchema.parse(null)).toThrow();
        expect(() => WorkspaceRoleSchema.parse(123)).toThrow();
      });
    });

    describe("AssignableMemberRoleSchema", () => {
      it("should validate assignable roles", () => {
        AssignableMemberRoles.forEach((role) => {
          expect(() => AssignableMemberRoleSchema.parse(role)).not.toThrow();
        });
      });

      it("should reject non-assignable roles", () => {
        expect(() => AssignableMemberRoleSchema.parse(WorkspaceRole.OWNER)).toThrow();
        expect(() => AssignableMemberRoleSchema.parse(WorkspaceRole.STAKEHOLDER)).toThrow();
      });

      it("should reject invalid values", () => {
        expect(() => AssignableMemberRoleSchema.parse("INVALID_ROLE")).toThrow();
        expect(() => AssignableMemberRoleSchema.parse("")).toThrow();
        expect(() => AssignableMemberRoleSchema.parse(null)).toThrow();
      });
    });
  });
});