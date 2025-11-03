import { describe, test, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  validateAccountOwnership,
  validateSourceControlTokenOwnership,
  validateTaskOwnership,
  validateFeatureOwnership,
} from "@/lib/helpers/user-authorization";
import {
  createTestUser,
  createTestWorkspace,
} from "@/__tests__/support/fixtures";
import { generateUniqueId } from "@/__tests__/support/helpers";
import { WorkspaceRole } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";

describe("User Authorization - Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  describe("validateAccountOwnership", () => {
    test("should validate that account belongs to correct user", async () => {
      const user = await createTestUser({ name: "Test User" });

      const account = await db.account.create({
        data: {
          id: generateUniqueId("account"),
          userId: user.id,
          type: "oauth",
          provider: "github",
          providerAccountId: generateUniqueId(),
          access_token: JSON.stringify(
            encryptionService.encryptField("access_token", "test_token_123")
          ),
        },
      });

      const isOwner = await validateAccountOwnership(user.id, account.id);
      expect(isOwner).toBe(true);
    });

    test("should reject access to account owned by different user", async () => {
      const owner = await createTestUser({ name: "Owner" });
      const otherUser = await createTestUser({ name: "Other User" });

      const account = await db.account.create({
        data: {
          id: generateUniqueId("account"),
          userId: owner.id,
          type: "oauth",
          provider: "github",
          providerAccountId: generateUniqueId(),
          access_token: JSON.stringify(
            encryptionService.encryptField("access_token", "test_token_123")
          ),
        },
      });

      const isOwner = await validateAccountOwnership(otherUser.id, account.id);
      expect(isOwner).toBe(false);
    });

    test("should reject access to non-existent account", async () => {
      const user = await createTestUser({ name: "Test User" });
      const fakeAccountId = "non-existent-account-id";

      const isOwner = await validateAccountOwnership(user.id, fakeAccountId);
      expect(isOwner).toBe(false);
    });
  });

  describe("validateSourceControlTokenOwnership", () => {
    test("should validate that token belongs to correct user", async () => {
      const user = await createTestUser({ name: "Test User" });

      // Create source control org
      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          id: generateUniqueId("org"),
          githubLogin: `test-org-${generateUniqueId()}`,
          githubInstallationId: Math.floor(Math.random() * 1000000),
          type: "ORG",
        },
      });

      // Create token for user
      const token = await db.sourceControlToken.create({
        data: {
          id: generateUniqueId("token"),
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(
            encryptionService.encryptField("token", "github_token_123")
          ),
        },
      });

      const isOwner = await validateSourceControlTokenOwnership(
        user.id,
        token.id
      );
      expect(isOwner).toBe(true);
    });

    test("should reject access to token owned by different user", async () => {
      const owner = await createTestUser({ name: "Owner" });
      const otherUser = await createTestUser({ name: "Other User" });

      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          id: generateUniqueId("org"),
          githubLogin: `test-org-${generateUniqueId()}`,
          githubInstallationId: Math.floor(Math.random() * 1000000),
          type: "ORG",
        },
      });

      const token = await db.sourceControlToken.create({
        data: {
          id: generateUniqueId("token"),
          userId: owner.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(
            encryptionService.encryptField("token", "github_token_123")
          ),
        },
      });

      const isOwner = await validateSourceControlTokenOwnership(
        otherUser.id,
        token.id
      );
      expect(isOwner).toBe(false);
    });
  });

  describe("validateTaskOwnership", () => {
    test("should validate task owner has access", async () => {
      const user = await createTestUser({ name: "Task Creator" });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
      });

      const task = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Test Task",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const access = await validateTaskOwnership(task.id, user.id);

      expect(access.hasAccess).toBe(true);
      expect(access.isOwner).toBe(true);
      expect(access.canModify).toBe(true);
    });

    test("should deny access to non-owner without admin role", async () => {
      const owner = await createTestUser({ name: "Task Owner" });
      const otherUser = await createTestUser({ name: "Other User" });
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
      });

      // Add other user as DEVELOPER (not admin)
      await db.workspaceMember.create({
        data: {
          id: generateUniqueId("member"),
          workspaceId: workspace.id,
          userId: otherUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      const task = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Test Task",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const access = await validateTaskOwnership(task.id, otherUser.id);

      expect(access.hasAccess).toBe(false);
      expect(access.isOwner).toBe(false);
      expect(access.canModify).toBe(false);
      expect(access.reason).toBe("User does not own this resource");
    });

    test("should grant access to workspace admin with override", async () => {
      const owner = await createTestUser({ name: "Task Owner" });
      const admin = await createTestUser({ name: "Workspace Admin" });
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
      });

      // Add admin user
      await db.workspaceMember.create({
        data: {
          id: generateUniqueId("member"),
          workspaceId: workspace.id,
          userId: admin.id,
          role: WorkspaceRole.ADMIN,
        },
      });

      const task = await db.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Test Task",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const access = await validateTaskOwnership(task.id, admin.id, {
        allowAdminOverride: true,
      });

      expect(access.hasAccess).toBe(true);
      expect(access.isOwner).toBe(false);
      expect(access.canModify).toBe(true);
      expect(access.reason).toBe("Admin override");
    });

    test("should return not found for non-existent task", async () => {
      const user = await createTestUser({ name: "Test User" });
      const fakeTaskId = "non-existent-task-id";

      const access = await validateTaskOwnership(fakeTaskId, user.id);

      expect(access.hasAccess).toBe(false);
      expect(access.reason).toBe("Task not found");
    });
  });

  describe("validateFeatureOwnership", () => {
    test("should validate feature owner has access", async () => {
      const user = await createTestUser({ name: "Feature Creator" });
      const workspace = await createTestWorkspace({
        ownerId: user.id,
        name: "Test Workspace",
      });

      const feature = await db.feature.create({
        data: {
          id: generateUniqueId("feature"),
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const access = await validateFeatureOwnership(feature.id, user.id);

      expect(access.hasAccess).toBe(true);
      expect(access.isOwner).toBe(true);
      expect(access.canModify).toBe(true);
    });

    test("should deny access to non-owner without admin role", async () => {
      const owner = await createTestUser({ name: "Feature Owner" });
      const otherUser = await createTestUser({ name: "Other User" });
      const workspace = await createTestWorkspace({
        ownerId: owner.id,
        name: "Test Workspace",
      });

      await db.workspaceMember.create({
        data: {
          id: generateUniqueId("member"),
          workspaceId: workspace.id,
          userId: otherUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      const feature = await db.feature.create({
        data: {
          id: generateUniqueId("feature"),
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const access = await validateFeatureOwnership(feature.id, otherUser.id);

      expect(access.hasAccess).toBe(false);
      expect(access.isOwner).toBe(false);
      expect(access.reason).toBe("User does not own this resource");
    });

    test("should grant access to workspace owner with override", async () => {
      const workspaceOwner = await createTestUser({ name: "Workspace Owner" });
      const featureCreator = await createTestUser({ name: "Feature Creator" });
      const workspace = await createTestWorkspace({
        ownerId: workspaceOwner.id,
        name: "Test Workspace",
      });

      await db.workspaceMember.create({
        data: {
          id: generateUniqueId("member"),
          workspaceId: workspace.id,
          userId: featureCreator.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      const feature = await db.feature.create({
        data: {
          id: generateUniqueId("feature"),
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: featureCreator.id,
          updatedById: featureCreator.id,
        },
      });

      const access = await validateFeatureOwnership(
        feature.id,
        workspaceOwner.id,
        {
          allowAdminOverride: true,
        }
      );

      expect(access.hasAccess).toBe(true);
      expect(access.isOwner).toBe(false);
      expect(access.canModify).toBe(true);
      expect(access.reason).toBe("Admin override");
    });
  });
});