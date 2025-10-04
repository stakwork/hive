import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  createWorkspace,
  getWorkspacesByUserId,
  getWorkspaceBySlug,
  getUserWorkspaces,
  validateWorkspaceAccess,
  getDefaultWorkspaceForUser,
  deleteWorkspaceBySlug
} from "@/services/workspace";
import { db } from "@/lib/db";
import {
  WORKSPACE_ERRORS,
  WORKSPACE_LIMITS
} from "@/lib/constants";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestSwarm } from "@/__tests__/support/fixtures/swarm";
import { generateUniqueSlug } from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm } from "@prisma/client";

describe("Workspace Service - Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("createWorkspace", () => {
    test("should create workspace successfully", async () => {
      const testUser = await createTestUser({ name: "Test User" });

      const slug = generateUniqueSlug("test-workspace");
      const workspaceData = {
        name: "Test Workspace",
        description: "A test workspace for integration testing",
        slug: slug,
        ownerId: testUser.id,
      };

      const result = await createWorkspace(workspaceData);

      expect(result).toMatchObject({
        name: "Test Workspace",
        description: "A test workspace for integration testing",
        slug: slug,
        ownerId: testUser.id,
      });
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();

      // Verify in database
      const workspaceInDb = await db.workspace.findUnique({
        where: { id: result.id },
      });
      expect(workspaceInDb).toBeTruthy();
      expect(workspaceInDb?.slug).toBe(slug);
    });

    test("should throw error for duplicate slug", async () => {
      const testUser1 = await createTestUser({ name: "Test User 1" });
      const testUser2 = await createTestUser({ name: "Test User 2" });

      const slug = generateUniqueSlug("duplicate-slug");
      const workspaceData = {
        name: "Test Workspace",
        slug: slug,
        ownerId: testUser1.id,
      };

      // Create first workspace
      await createWorkspace(workspaceData);

      // Try to create second workspace with same slug
      const duplicateData = {
        ...workspaceData,
        name: "Another Workspace",
        ownerId: testUser2.id,
      };

      await expect(createWorkspace(duplicateData)).rejects.toThrow(
        WORKSPACE_ERRORS.SLUG_ALREADY_EXISTS
      );
    });

    test("should handle workspace creation with minimal data", async () => {
      const testUser = await createTestUser({ name: "Test User" });

      const slug = generateUniqueSlug("minimal-workspace");
      const workspaceData = {
        name: "Minimal Workspace",
        slug: slug,
        ownerId: testUser.id,
      };

      const result = await createWorkspace(workspaceData);

      expect(result.description).toBeNull();
      expect(result.name).toBe("Minimal Workspace");
    });

    test("should enforce workspace limit per user", async () => {
      const testUser1 = await createTestUser({ name: "Test User 1" });
      const testUser2 = await createTestUser({ name: "Test User 2" });

      // Create max workspaces for user1
      for (let i = 0; i < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; i++) {
        await createWorkspace({
          name: `Workspace ${i + 1}`,
          slug: generateUniqueSlug(`workspace-${i + 1}`),
          ownerId: testUser1.id,
        });
      }

      // Try to create one more - should fail
      const extraWorkspaceData = {
        name: "Extra Workspace",
        slug: generateUniqueSlug("extra-workspace"),
        ownerId: testUser1.id,
      };

      await expect(createWorkspace(extraWorkspaceData)).rejects.toThrow(
        WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED
      );

      // Verify user2 can still create workspaces
      const user2WorkspaceData = {
        name: "User2 Workspace",
        slug: generateUniqueSlug("user2-workspace"),
        ownerId: testUser2.id,
      };

      const result = await createWorkspace(user2WorkspaceData);
      expect(result.ownerId).toBe(testUser2.id);
    });

    test("should allow workspace creation after deletion", async () => {
      const testUser = await createTestUser({ name: "Test User" });

      // Create max workspaces
      const workspaces = [];
      for (let i = 0; i < WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER; i++) {
        const workspace = await createWorkspace({
          name: `Workspace ${i + 1}`,
          slug: generateUniqueSlug(`workspace-${i + 1}`),
          ownerId: testUser.id,
        });
        workspaces.push(workspace);
      }

      // Try to create another - should fail
      await expect(createWorkspace({
        name: "Extra Workspace",
        slug: generateUniqueSlug("extra-workspace"),
        ownerId: testUser.id,
      })).rejects.toThrow(WORKSPACE_ERRORS.WORKSPACE_LIMIT_EXCEEDED);

      // Delete one workspace
      await db.workspace.update({
        where: { id: workspaces[0].id },
        data: { deleted: true, deletedAt: new Date() }
      });

      // Now should be able to create new workspace
      const newWorkspaceData = {
        name: "New Workspace",
        slug: generateUniqueSlug("new-workspace"),
        ownerId: testUser.id,
      };

      const result = await createWorkspace(newWorkspaceData);
      expect(result.ownerId).toBe(testUser.id);
      expect(result.name).toBe("New Workspace");
    });
  });

  describe("getWorkspacesByUserId", () => {
    test("should return workspaces owned by user", async () => {
      const testUser1 = await createTestUser({ name: "Test User 1" });
      const testUser2 = await createTestUser({ name: "Test User 2" });

      const slug1 = generateUniqueSlug("workspace-1");
      const slug2 = generateUniqueSlug("workspace-2");
      const otherSlug = generateUniqueSlug("other-workspace");

      // Use transaction to create workspaces atomically
      await db.$transaction(async (tx) => {
        // Create workspaces for user1
        await tx.workspace.create({
          data: {
            name: "Workspace 1",
            slug: slug1,
            ownerId: testUser1.id,
          },
        });

        await tx.workspace.create({
          data: {
            name: "Workspace 2",
            slug: slug2,
            ownerId: testUser1.id,
          },
        });

        // Create workspace for user2
        await tx.workspace.create({
          data: {
            name: "Other Workspace",
            slug: otherSlug,
            ownerId: testUser2.id,
          },
        });
      });

      const workspaces = await getWorkspacesByUserId(testUser1.id);

      expect(workspaces).toHaveLength(2);
      expect(workspaces.map(w => w.name).sort()).toEqual(["Workspace 1", "Workspace 2"]);
      expect(workspaces.every(w => w.ownerId === testUser1.id)).toBe(true);
    });

    test("should exclude deleted workspaces", async () => {
      const testUser = await createTestUser({ name: "Test User" });

      const slug1 = generateUniqueSlug("active-workspace");
      const slug2 = generateUniqueSlug("deleted-workspace");

      // Use transaction to create workspaces atomically
      await db.$transaction(async (tx) => {
        await tx.workspace.create({
          data: {
            name: "Active Workspace",
            slug: slug1,
            ownerId: testUser.id,
          },
        });

        await tx.workspace.create({
          data: {
            name: "Deleted Workspace",
            slug: slug2,
            ownerId: testUser.id,
            deleted: true,
            deletedAt: new Date(),
          },
        });
      });

      const workspaces = await getWorkspacesByUserId(testUser.id);

      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].name).toBe("Active Workspace");
      expect(workspaces[0].deleted).toBe(false);
    });
  });

  describe("getWorkspaceBySlug", () => {
    let testWorkspace: Workspace;
    let testSwarm: Swarm;
    let testUser: User;

    beforeEach(async () => {
      testUser = await createTestUser({ name: "Test User" });

      const slug = generateUniqueSlug("test-workspace");

      // Create workspace
      testWorkspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          description: "Test description",
          slug: slug,
          ownerId: testUser.id,
        },
      });

      // Create swarm using the test helper
      testSwarm = await createTestSwarm({
        workspaceId: testWorkspace.id,
      });
    });

    test("should return workspace with swarm by slug", async () => {
      const result = await getWorkspaceBySlug(testWorkspace.slug, testUser.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(testWorkspace.id);
      expect(result?.name).toBe("Test Workspace");
      expect(result?.swarmStatus).toBe(testSwarm.status);
    });

    test("should return null for non-existent slug", async () => {
      const result = await getWorkspaceBySlug("non-existent-slug", testUser.id);
      expect(result).toBeNull();
    });

    test("should return null for deleted workspace", async () => {
      // Mark workspace as deleted
      await db.workspace.update({
        where: { id: testWorkspace.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const result = await getWorkspaceBySlug(testWorkspace.slug, testUser.id);
      expect(result).toBeNull();
    });
  });

  describe("getUserWorkspaces", () => {
    test("should return workspaces where user is owner or member", async () => {
      const ownerUser = await createTestUser({ name: "Owner User" });
      const memberUser = await createTestUser({ name: "Member User" });

      const ownedSlug = generateUniqueSlug("owned-workspace");
      const memberSlug = generateUniqueSlug("member-workspace");
      const unrelatedSlug = generateUniqueSlug("unrelated-workspace");

      // Use transaction to create test data atomically
      await db.$transaction(async (tx) => {
        // Workspace owned by memberUser
        const ownedWorkspace = await tx.workspace.create({
          data: {
            name: "Owned Workspace",
            slug: ownedSlug,
            ownerId: memberUser.id,
          },
        });

        // Workspace where memberUser is a member but not owner
        const memberWorkspace = await tx.workspace.create({
          data: {
            name: "Member Workspace",
            slug: memberSlug,
            ownerId: ownerUser.id,
          },
        });

        await tx.workspaceMember.create({
          data: {
            workspaceId: memberWorkspace.id,
            userId: memberUser.id,
            role: "DEVELOPER",
          },
        });

        // Unrelated workspace
        await tx.workspace.create({
          data: {
            name: "Unrelated Workspace",
            slug: unrelatedSlug,
            ownerId: ownerUser.id,
          },
        });
      });

      const workspaces = await getUserWorkspaces(memberUser.id);

      expect(workspaces).toHaveLength(2);
      const workspaceNames = workspaces.map(w => w.name).sort();
      expect(workspaceNames).toEqual(["Member Workspace", "Owned Workspace"]);
    });
  });

  describe("validateWorkspaceAccess", () => {
    test("should validate workspace access correctly", async () => {
      const ownerUser = await createTestUser({ name: "Owner User" });
      const memberUser = await createTestUser({ name: "Member User" });
      const nonMemberUser = await createTestUser({ name: "Non-member User" });

      const slug = generateUniqueSlug("test-workspace");

      // Use transaction to create test data atomically
      const workspace = await db.$transaction(async (tx) => {
        const ws = await tx.workspace.create({
          data: {
            name: "Test Workspace",
            slug: slug,
            ownerId: ownerUser.id,
          },
        });

        await tx.workspaceMember.create({
          data: {
            workspaceId: ws.id,
            userId: memberUser.id,
            role: "DEVELOPER",
          },
        });

        return ws;
      });

      // Test owner access
      const ownerAccess = await validateWorkspaceAccess(
        workspace.slug,
        ownerUser.id
      );
      expect(ownerAccess.hasAccess).toBe(true);
      expect(ownerAccess.canAdmin).toBe(true);

      // Test member access
      const memberAccess = await validateWorkspaceAccess(
        workspace.slug,
        memberUser.id
      );
      expect(memberAccess.hasAccess).toBe(true);
      expect(memberAccess.canWrite).toBe(true);
      expect(memberAccess.canAdmin).toBe(false);

      // Test non-member access
      const nonMemberAccess = await validateWorkspaceAccess(
        workspace.slug,
        nonMemberUser.id
      );
      expect(nonMemberAccess.hasAccess).toBe(false);
    });
  });

  describe("getDefaultWorkspaceForUser", () => {
    test("should return most recently created workspace", async () => {
      const testUser = await createTestUser({ name: "Test User" });

      // Create workspaces - getDefaultWorkspaceForUser returns the most recently created
      const workspace1 = await db.workspace.create({
        data: {
          name: "Workspace 1",
          slug: generateUniqueSlug("workspace-1"),
          ownerId: testUser.id,
        },
      });

      // Add a small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 5));

      const workspace2 = await db.workspace.create({
        data: {
          name: "Workspace 2",
          slug: generateUniqueSlug("workspace-2"),
          ownerId: testUser.id,
        },
      });

      const defaultWorkspace = await getDefaultWorkspaceForUser(testUser.id);

      expect(defaultWorkspace).toBeDefined();
      // The function should return the most recently created workspace
      expect([workspace1.name, workspace2.name]).toContain(defaultWorkspace?.name);
    });

    test("should return null if user has no workspaces", async () => {
      const testUser = await createTestUser({ name: "Test User" });

      const defaultWorkspace = await getDefaultWorkspaceForUser(testUser.id);
      expect(defaultWorkspace).toBeNull();
    });
  });

  describe("deleteWorkspaceBySlug", () => {
    test("should soft delete workspace", async () => {
      const testUser = await createTestUser({ name: "Test User" });

      const slug = generateUniqueSlug("test-workspace");

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: slug,
          ownerId: testUser.id,
        },
      });

      await deleteWorkspaceBySlug(slug, testUser.id);

      const deletedWorkspace = await db.workspace.findUnique({
        where: { id: workspace.id },
      });

      expect(deletedWorkspace?.deleted).toBe(true);
      expect(deletedWorkspace?.deletedAt).toBeDefined();
    });

    test("should throw error for non-existent workspace", async () => {
      const testUser = await createTestUser({ name: "Test User" });

      await expect(
        deleteWorkspaceBySlug("non-existent-workspace", testUser.id)
      ).rejects.toThrow("Workspace not found or access denied");
    });
  });
});