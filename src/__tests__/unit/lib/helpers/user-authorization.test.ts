import { describe, test, expect } from "vitest";
import { WorkspaceRole } from "@prisma/client";
import {
  validateUserResourceOwnership,
  extractUserId,
} from "@/lib/helpers/user-authorization";

describe("User Authorization Helpers - Unit Tests", () => {
  describe("validateUserResourceOwnership", () => {
    const ownerId = "user-123";
    const requesterId = "user-456";

    test("should grant access when user owns the resource", () => {
      const result = validateUserResourceOwnership(ownerId, ownerId);

      expect(result).toEqual({
        hasAccess: true,
        isOwner: true,
        canModify: true,
      });
    });

    test("should deny access when user does not own the resource", () => {
      const result = validateUserResourceOwnership(ownerId, requesterId);

      expect(result).toEqual({
        hasAccess: false,
        isOwner: false,
        canModify: false,
        reason: "User does not own this resource",
      });
    });

    test("should grant access to ADMIN users with override enabled", () => {
      const result = validateUserResourceOwnership(ownerId, requesterId, {
        workspaceRole: WorkspaceRole.ADMIN,
        allowAdminOverride: true,
      });

      expect(result).toEqual({
        hasAccess: true,
        isOwner: false,
        canModify: true,
        reason: "Admin override",
      });
    });

    test("should grant access to OWNER users with override enabled", () => {
      const result = validateUserResourceOwnership(ownerId, requesterId, {
        workspaceRole: WorkspaceRole.OWNER,
        allowAdminOverride: true,
      });

      expect(result).toEqual({
        hasAccess: true,
        isOwner: false,
        canModify: true,
        reason: "Admin override",
      });
    });

    test("should deny access to non-admin roles even with override enabled", () => {
      const roles: WorkspaceRole[] = [
        WorkspaceRole.DEVELOPER,
        WorkspaceRole.PM,
        WorkspaceRole.STAKEHOLDER,
        WorkspaceRole.VIEWER,
      ];

      roles.forEach((role) => {
        const result = validateUserResourceOwnership(ownerId, requesterId, {
          workspaceRole: role,
          allowAdminOverride: true,
        });

        expect(result.hasAccess).toBe(false);
        expect(result.reason).toBe("User does not own this resource");
      });
    });

    test("should deny access to admins when override is disabled", () => {
      const result = validateUserResourceOwnership(ownerId, requesterId, {
        workspaceRole: WorkspaceRole.ADMIN,
        allowAdminOverride: false,
      });

      expect(result).toEqual({
        hasAccess: false,
        isOwner: false,
        canModify: false,
        reason: "User does not own this resource",
      });
    });

    test("should deny access when no workspace role provided", () => {
      const result = validateUserResourceOwnership(ownerId, requesterId, {
        allowAdminOverride: true,
        // No workspaceRole provided
      });

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe("User does not own this resource");
    });

    test("should handle default options correctly", () => {
      // Default: allowAdminOverride = true, but no role provided
      const result = validateUserResourceOwnership(ownerId, requesterId);

      expect(result.hasAccess).toBe(false);
    });
  });

  describe("extractUserId", () => {
    test("should extract userId from valid session", () => {
      const session = {
        user: { id: "user-123", email: "test@example.com" },
      };

      const userId = extractUserId(session);
      expect(userId).toBe("user-123");
    });

    test("should return null for null session", () => {
      const userId = extractUserId(null);
      expect(userId).toBeNull();
    });

    test("should return null for session without user", () => {
      const session = {};
      const userId = extractUserId(session);
      expect(userId).toBeNull();
    });

    test("should return null for session with user but no id", () => {
      const session = {
        user: { email: "test@example.com" },
      };
      const userId = extractUserId(session);
      expect(userId).toBeNull();
    });

    test("should return null for session with empty id", () => {
      const session = {
        user: { id: "", email: "test@example.com" },
      };
      const userId = extractUserId(session);
      expect(userId).toBeNull();
    });
  });
});