import { describe, it, expect, beforeEach } from "vitest";
import { getWorkspaceBySlug } from "@/services/workspace";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace, createTestMembership } from "@/__tests__/support/factories";

describe("Workspace Service - workspaceKind field", () => {
  let owner: { id: string; email: string };
  let member: { id: string; email: string };
  let superAdminUser: { id: string; email: string };

  beforeEach(async () => {
    owner = await createTestUser({ email: "owner-wk@test.com" });
    member = await createTestUser({ email: "member-wk@test.com" });
    superAdminUser = await createTestUser({ role: "SUPER_ADMIN", email: "super-wk@test.com" });
  });

  describe("getWorkspaceBySlug returns workspaceKind", () => {
    it("returns workspaceKind for owner when set to 'graph'", async () => {
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await db.workspace.update({
        where: { id: workspace.id },
        data: { workspaceKind: "graph" },
      });

      const result = await getWorkspaceBySlug(workspace.slug, owner.id);

      expect(result).not.toBeNull();
      expect(result?.workspaceKind).toBe("graph");
    });

    it("returns workspaceKind for member when set to 'graph'", async () => {
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await db.workspace.update({
        where: { id: workspace.id },
        data: { workspaceKind: "graph" },
      });
      await createTestMembership({
        workspaceId: workspace.id,
        userId: member.id,
        role: "DEVELOPER",
      });

      const result = await getWorkspaceBySlug(workspace.slug, member.id);

      expect(result).not.toBeNull();
      expect(result?.workspaceKind).toBe("graph");
    });

    it("returns workspaceKind for superadmin bypass", async () => {
      const workspace = await createTestWorkspace({ ownerId: owner.id });
      await db.workspace.update({
        where: { id: workspace.id },
        data: { workspaceKind: "graph" },
      });

      const result = await getWorkspaceBySlug(workspace.slug, superAdminUser.id, {
        isSuperAdmin: true,
      });

      expect(result).not.toBeNull();
      expect(result?.workspaceKind).toBe("graph");
    });

    it("returns null workspaceKind when not set", async () => {
      const workspace = await createTestWorkspace({ ownerId: owner.id });

      const result = await getWorkspaceBySlug(workspace.slug, owner.id);

      expect(result).not.toBeNull();
      expect(result?.workspaceKind).toBeNull();
    });
  });
});
