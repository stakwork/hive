import { describe, it, expect, beforeAll } from "vitest";
import { getWorkspaceBySlug } from "@/services/workspace";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/factories";

describe("Workspace Service - Superadmin Bypass", () => {
  let superAdminUser: { id: string; email: string };
  let regularUser: { id: string; email: string };
  let workspaceOwner: { id: string; email: string };
  let workspace: { id: string; slug: string; name: string };

  beforeEach(async () => {
    // Create test users (beforeEach because resetDatabase runs beforeEach)
    superAdminUser = await createTestUser({ role: "SUPER_ADMIN", email: "superadmin@test.com" });
    regularUser = await createTestUser({ role: "USER", email: "regular@test.com" });
    workspaceOwner = await createTestUser({ role: "USER", email: "owner@test.com" });

    // Create a workspace owned by workspaceOwner
    workspace = await createTestWorkspace({
      ownerId: workspaceOwner.id,
      name: "Test Workspace",
      slug: "test-workspace",
    });
  });

  describe("getWorkspaceBySlug with isSuperAdmin option", () => {
    it("should grant access to workspace when isSuperAdmin is true", async () => {
      const result = await getWorkspaceBySlug(workspace.slug, superAdminUser.id, {
        isSuperAdmin: true,
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(workspace.id);
      expect(result?.slug).toBe(workspace.slug);
    });

    it("should grant OWNER role to superadmin with bypass", async () => {
      const result = await getWorkspaceBySlug(workspace.slug, superAdminUser.id, {
        isSuperAdmin: true,
      });

      expect(result).not.toBeNull();
      expect(result?.userRole).toBe("OWNER");
    });

    it("should return null for non-member regular user without bypass", async () => {
      const result = await getWorkspaceBySlug(workspace.slug, regularUser.id);

      expect(result).toBeNull();
    });

    it("should return workspace for owner without bypass", async () => {
      const result = await getWorkspaceBySlug(workspace.slug, workspaceOwner.id);

      expect(result).not.toBeNull();
      expect(result?.id).toBe(workspace.id);
      expect(result?.userRole).toBe("OWNER");
    });

    it("should bypass membership check when isSuperAdmin is true", async () => {
      // Superadmin accessing a workspace they don't belong to
      const result = await getWorkspaceBySlug(workspace.slug, superAdminUser.id, {
        isSuperAdmin: true,
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(workspace.id);
      expect(result?.userRole).toBe("OWNER"); // Full permissions granted
    });

    it("should not bypass membership check when isSuperAdmin is false", async () => {
      const result = await getWorkspaceBySlug(workspace.slug, superAdminUser.id, {
        isSuperAdmin: false,
      });

      expect(result).toBeNull();
    });

    it("should not bypass membership check when options is undefined", async () => {
      const result = await getWorkspaceBySlug(workspace.slug, superAdminUser.id);

      expect(result).toBeNull();
    });

    it("should include all workspace data when bypassing as superadmin", async () => {
      const result = await getWorkspaceBySlug(workspace.slug, superAdminUser.id, {
        isSuperAdmin: true,
      });

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("name");
      expect(result).toHaveProperty("slug");
      expect(result).toHaveProperty("owner");
      expect(result).toHaveProperty("repositories");
      expect(result).toHaveProperty("userRole");
      expect(result?.userRole).toBe("OWNER");
    });

    it("should return null for non-existent workspace even with superadmin bypass", async () => {
      const result = await getWorkspaceBySlug("non-existent-slug", superAdminUser.id, {
        isSuperAdmin: true,
      });

      expect(result).toBeNull();
    });
  });
});
