import { describe, test, expect, beforeEach, beforeAll } from "vitest";
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
  WORKSPACE_ERRORS
} from "@/lib/constants";
import type { User, Workspace, Swarm } from "@prisma/client";

describe("Workspace Service - Integration Tests", () => {
   const generateRandomString = (length = 8) => {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
  };

  let testUser1: User;
  let testUser2: User;
  let testUser3: User;

  beforeEach(async () => {
    // Create test users
    testUser1 = await db.user.create({
      data: {
        name: "Test User 1",
        email: `user1_${generateRandomString()}@example.com`,
      },
    });

    testUser2 = await db.user.create({
      data: {
        name: "Test User 2", 
        email: `user2_${generateRandomString()}@example.com`,
      },
    });

    testUser3 = await db.user.create({
      data: {
        name: "Test User 3",
        email: `user3_${generateRandomString()}@example.com`,
      },
    });
  });

  describe("createWorkspace", () => {
    test("should create workspace successfully", async () => {
      const slug_value = `test-workspace${generateRandomString()}`
      const workspaceData = {
        name: "Test Workspace",
        description: "A test workspace for integration testing",
        slug: slug_value,
        ownerId: testUser1.id,
      };

      const result = await createWorkspace(workspaceData);

      expect(result).toMatchObject({
        name: "Test Workspace",
        description: "A test workspace for integration testing",
        slug: slug_value,
        ownerId: testUser1.id,
      });
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();

      // Verify in database
      const workspaceInDb = await db.workspace.findUnique({
        where: { id: result.id },
      });
      expect(workspaceInDb).toBeTruthy();
      expect(workspaceInDb?.slug).toBe(slug_value);
    });

    test("should throw error for duplicate slug", async () => {
      const slug_value = `duplicat-slug${generateRandomString()}`
      const workspaceData = {
        name: "Test Workspace",
        slug: slug_value,
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
      const slug_value = `minimal-workspace${generateRandomString()}`
      const workspaceData = {
        name: "Minimal Workspace",
        slug: slug_value,
        ownerId: testUser1.id,
      };

      const result = await createWorkspace(workspaceData);

      expect(result.description).toBeNull();
      expect(result.name).toBe("Minimal Workspace");
    });
  });

  describe("getWorkspacesByUserId", () => {
    test("should return workspaces owned by user", async () => {
      const slug_value = `workspace-1${generateRandomString()}`
      const slug_value_2 = `workspace-2${generateRandomString()}`
      const other_slug_value = `other-workspace${generateRandomString()}`
      // Create workspaces for user1
      await db.workspace.create({
        data: {
          name: "Workspace 1",
          slug: slug_value,
          ownerId: testUser1.id,
        },
      });

      await db.workspace.create({
        data: {
          name: "Workspace 2",
          slug: slug_value_2, 
          ownerId: testUser1.id,
        },
      });

      // Create workspace for user2 (should not be returned)
      await db.workspace.create({
        data: {
          name: "Other Workspace",
          slug: other_slug_value,
          ownerId: testUser2.id,
        },
      });

      const result = await getWorkspacesByUserId(testUser1.id);

      expect(result).toHaveLength(2);
      expect(result.map(w => w.slug)).toContain(slug_value);
      expect(result.map(w => w.slug)).toContain(slug_value_2);
      expect(result.map(w => w.slug)).not.toContain(other_slug_value);
    });

    test("should return empty array for user with no workspaces", async () => {
      const result = await getWorkspacesByUserId(testUser1.id);
      expect(result).toEqual([]);
    });
  });

  describe("getWorkspaceBySlug", () => {
    let slug_value: string;
    let name_value: string;
    let testWorkspace: Workspace;
    let testSwarm: Swarm;

    beforeEach(async () => {
      slug_value = `test-workspace${generateRandomString()}`
      name_value = `test-swarm${generateRandomString()}`
      testWorkspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          description: "Test description",
          slug: slug_value,
          ownerId: testUser1.id,
          stakworkApiKey: "test-api-key",
        },
      });

      testSwarm = await db.swarm.create({
        data: {
          name: name_value,
          status: "ACTIVE",
          instanceType: "XL",
          workspaceId: testWorkspace.id,
        },
      });
    });

    test("should return workspace for owner", async () => {
      const result = await getWorkspaceBySlug(slug_value, testUser1.id);

      expect(result).toMatchObject({
        id: testWorkspace.id,
        name: "Test Workspace",
        description: "Test description",
        slug: slug_value,
        ownerId: testUser1.id,
        userRole: "OWNER",
        hasKey: true,
        isCodeGraphSetup: true,
      });
      expect(result?.owner).toMatchObject({
        id: testUser1.id,
        name: testUser1.name,
        email: testUser1.email,
      });
    });

    test("should return workspace for member", async () => {
      // Add user2 as a member
      await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: testUser2.id,
          role: "DEVELOPER",
        },
      });

      const result = await getWorkspaceBySlug(slug_value, testUser2.id);

      expect(result).toMatchObject({
        id: testWorkspace.id,
        userRole: "DEVELOPER",
        hasKey: true,
        isCodeGraphSetup: true,
      });
    });

    test("should return null for non-member", async () => {
      const result = await getWorkspaceBySlug(slug_value, testUser2.id);
      expect(result).toBeNull();
    });

    test("should return null for non-existent workspace", async () => {
      const result = await getWorkspaceBySlug("non-existent", testUser1.id);
      expect(result).toBeNull();
    });

    test("should handle workspace without swarm", async () => {
      const slug_value_no_swarm = `no-swarm${generateRandomString()}`

      await db.workspace.create({
        data: {
          name: "No Swarm Workspace",
          slug: slug_value_no_swarm,
          ownerId: testUser1.id,
        },
      });

      const result = await getWorkspaceBySlug(slug_value_no_swarm, testUser1.id);

      expect(result?.isCodeGraphSetup).toBe(false);
    });

    test("should handle workspace with inactive swarm", async () => {
      await db.swarm.update({
        where: { id: testSwarm.id },
        data: { status: "FAILED" },
      });

      const result = await getWorkspaceBySlug(slug_value, testUser1.id);

      expect(result?.isCodeGraphSetup).toBe(false);
    });
  });

  describe("getUserWorkspaces", () => {
    beforeEach(async () => {
      const slug_value = `owned-workspace${generateRandomString()}`
      // Create owned workspace
      const ownedWorkspace = await db.workspace.create({
        data: {
          name: "Owned Workspace",
          slug: slug_value,
          ownerId: testUser1.id,
        },
      });

      const slug_value_2 = `member-workspace${generateRandomString()}`
      // Create member workspace
      const memberWorkspace = await db.workspace.create({
        data: {
          name: "Member Workspace",
          slug: slug_value_2,
          ownerId: testUser2.id,
        },
      });

      // Add user1 as member to the second workspace
      await db.workspaceMember.create({
        data: {
          workspaceId: memberWorkspace.id,
          userId: testUser1.id,
          role: "PM",
        },
      });

      // Add some other members for count testing
      await db.workspaceMember.create({
        data: {
          workspaceId: ownedWorkspace.id,
          userId: testUser2.id,
          role: "DEVELOPER",
        },
      });

      await db.workspaceMember.create({
        data: {
          workspaceId: memberWorkspace.id,
          userId: testUser3.id,
          role: "VIEWER",
        },
      });
    });

    test("should return all workspaces user has access to", async () => {
      const result = await getUserWorkspaces(testUser1.id);

      expect(result).toHaveLength(2);
      
      // Should be sorted by name
      expect(result[0].name).toBe("Member Workspace");
      expect(result[0].userRole).toBe("PM");
      expect(result[0].memberCount).toBe(3); // owner + testUser1 + testUser3

      expect(result[1].name).toBe("Owned Workspace");
      expect(result[1].userRole).toBe("OWNER");
      expect(result[1].memberCount).toBe(2); // owner + testUser2
    });

    test("should handle user with no workspace access", async () => {
      const email_value = `isolated${generateRandomString()}@example.com`
      // Create a new user with no workspace access
      const isolatedUser = await db.user.create({
        data: {
          name: "Isolated User",
          email: email_value,
        },
      });

      const result = await getUserWorkspaces(isolatedUser.id);
      expect(result).toEqual([]);
    });

    test("should exclude left members from count", async () => {
      const slug_value = `test-count${generateRandomString()}`
      const workspace = await db.workspace.create({
        data: {
          name: "Test Count Workspace",
          slug: slug_value,
          ownerId: testUser1.id,
        },
      });

      // Add active member
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: testUser2.id,
          role: "DEVELOPER",
        },
      });

      // Add left member
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: testUser3.id,
          role: "VIEWER",
          leftAt: new Date(),
        },
      });

      const result = await getUserWorkspaces(testUser1.id);
      const testWorkspace = result.find(w => w.slug === slug_value);

      expect(testWorkspace?.memberCount).toBe(2); // owner + active member only
    });
  });

  describe("validateWorkspaceAccess", () => {
    let testWorkspace: Workspace;
    let slug_value: string

    beforeEach(async () => {
      slug_value = `access-test${generateRandomString()}`
      testWorkspace = await db.workspace.create({
        data: {
          name: "Access Test Workspace",
          slug: slug_value,
          ownerId: testUser1.id,
        },
      });
    });

    test("should validate owner access", async () => {
      const result = await validateWorkspaceAccess(slug_value, testUser1.id);

      expect(result).toMatchObject({
        hasAccess: true,
        userRole: "OWNER",
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });
      expect(result.workspace).toMatchObject({
        id: testWorkspace.id,
        slug: slug_value,
      });
    });

    test("should validate different role permissions", async () => {
      // Test different roles
      const roles = [
        { role: "VIEWER", canRead: true, canWrite: false, canAdmin: false },
        { role: "STAKEHOLDER", canRead: true, canWrite: false, canAdmin: false },
        { role: "DEVELOPER", canRead: true, canWrite: true, canAdmin: false },
        { role: "PM", canRead: true, canWrite: true, canAdmin: false },
        { role: "ADMIN", canRead: true, canWrite: true, canAdmin: true },
      ];

      for (const { role, canRead, canWrite, canAdmin } of roles) {
        // Create membership with specific role
        await db.workspaceMember.deleteMany({
          where: { workspaceId: testWorkspace.id, userId: testUser2.id },
        });

        await db.workspaceMember.create({
          data: {
            workspaceId: testWorkspace.id,
            userId: testUser2.id,
            role: role,
          },
        });

        const result = await validateWorkspaceAccess(slug_value, testUser2.id);

        expect(result).toMatchObject({
          hasAccess: true,
          userRole: role,
          canRead,
          canWrite,
          canAdmin,
        });
      }
    });

    test("should deny access for non-member", async () => {
      const result = await validateWorkspaceAccess(slug_value, testUser2.id);

      expect(result).toMatchObject({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });
      expect(result.userRole).toBeUndefined();
      expect(result.workspace).toBeUndefined();
    });

    test("should deny access for non-existent workspace", async () => {
      const result = await validateWorkspaceAccess("non-existent", testUser1.id);

      expect(result).toMatchObject({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });
    });
  });

  describe("getDefaultWorkspaceForUser", () => {
    test("should return oldest owned workspace", async () => {
      // Create workspaces with different creation times
      const slug_value = `first-workspace${generateRandomString()}`
      const slug_value_2 = `second-workspace${generateRandomString()}`
      const firstWorkspace = await db.workspace.create({
        data: {
          name: "First Workspace",
          slug: slug_value,
          ownerId: testUser1.id,
          createdAt: new Date("2024-01-01"),
        },
      });

      await db.workspace.create({
        data: {
          name: "Second Workspace",
          slug: slug_value_2,
          ownerId: testUser1.id,
          createdAt: new Date("2024-01-02"),
        },
      });

      const result = await getDefaultWorkspaceForUser(testUser1.id);

      expect(result?.id).toBe(firstWorkspace.id);
      expect(result?.slug).toBe(slug_value);
    });

    test("should return oldest member workspace if no owned", async () => {
      const slug_value = `member-workspace${generateRandomString()}`
      const memberWorkspace = await db.workspace.create({
        data: {
          name: "Member Workspace",
          slug: slug_value, 
          ownerId: testUser2.id,
        },
      });

      await db.workspaceMember.create({
        data: {
          workspaceId: memberWorkspace.id,
          userId: testUser1.id,
          role: "DEVELOPER",
          joinedAt: new Date("2024-01-01"),
        },
      });

      const slug_value_2 = `another-workspace${generateRandomString()}`
      // Create another membership to ensure it picks the oldest
      const anotherWorkspace = await db.workspace.create({
        data: {
          name: "Another Workspace",
          slug: slug_value_2,
          ownerId: testUser2.id,
        },
      });

      await db.workspaceMember.create({
        data: {
          workspaceId: anotherWorkspace.id,
          userId: testUser1.id,
          role: "PM",
          joinedAt: new Date("2024-01-02"),
        },
      });

      const result = await getDefaultWorkspaceForUser(testUser1.id);

      expect(result?.id).toBe(memberWorkspace.id);
      expect(result?.slug).toBe(slug_value);
    });

    test("should return null if user has no workspaces", async () => {
      const result = await getDefaultWorkspaceForUser(testUser1.id);
      expect(result).toBeNull();
    });
  });

  describe("deleteWorkspaceBySlug", () => {
    let testWorkspace: Workspace;
    let slug_value: string
    beforeEach(async () => {
      slug_value = `delete-test${generateRandomString()}`
      testWorkspace = await db.workspace.create({
        data: {
          name: "Delete Test Workspace",
          slug: slug_value,
          ownerId: testUser1.id,
        },
      });

      // Add some related data to test cascade deletion
      await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: testUser2.id,
          role: "DEVELOPER",
        },
      });

      await db.product.create({
        data: {
          name: "Test Product",
          workspaceId: testWorkspace.id,
        },
      });
    });

    test("should delete workspace as owner", async () => {
      await deleteWorkspaceBySlug(slug_value, testUser1.id);

      // Verify workspace is soft deleted
      const deletedWorkspace = await db.workspace.findUnique({
        where: { id: testWorkspace.id },
      });
      expect(deletedWorkspace).not.toBeNull();
      expect(deletedWorkspace?.deleted).toBe(true);
      expect(deletedWorkspace?.deletedAt).toBeInstanceOf(Date);

      // Verify the workspace is no longer accessible through filtered queries
      const accessibleWorkspace = await db.workspace.findUnique({
        where: { id: testWorkspace.id, deleted: false },
      });
      expect(accessibleWorkspace).toBeNull();
    });

    test("should throw error if user is not owner", async () => {
      await expect(deleteWorkspaceBySlug(slug_value, testUser2.id))
        .rejects.toThrow("Only workspace owners can delete workspaces");

      // Verify workspace still exists
      const workspace = await db.workspace.findUnique({
        where: { id: testWorkspace.id },
      });
      expect(workspace).toBeTruthy();
    });

    test("should throw error if workspace does not exist", async () => {
      await expect(deleteWorkspaceBySlug("non-existent", testUser1.id))
        .rejects.toThrow("Workspace not found or access denied");
    });

    test("should throw error if user has no access", async () => {
      await expect(deleteWorkspaceBySlug("delete-test", testUser3.id))
        .rejects.toThrow("Workspace not found or access denied");
    });
  });

  describe("Complex scenarios", () => {
    test("should handle workspace with left members correctly", async () => {
      const slug_value = `complex-workspace${generateRandomString()}`
      const workspace = await db.workspace.create({
        data: {
          name: "Complex Workspace",
          slug: slug_value,
          ownerId: testUser1.id,
        },
      });

      // Add active member
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: testUser2.id,
          role: "DEVELOPER",
        },
      });

      // Add member who left
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: testUser3.id,
          role: "ADMIN",
          leftAt: new Date(),
        },
      });

      // Test getWorkspaceBySlug - should not find access for left member
      const resultForLeftMember = await getWorkspaceBySlug(slug_value, testUser3.id);
      expect(resultForLeftMember).toBeNull();

      // Test getUserWorkspaces - should not include left member in count
      const userWorkspaces = await getUserWorkspaces(testUser1.id);
      const complexWorkspace = userWorkspaces.find(w => w.slug === slug_value);
      expect(complexWorkspace?.memberCount).toBe(2); // owner + active member only
    });

    test("should handle workspace operations across multiple users", async () => {
      const slug_value = `multi-user-1${generateRandomString()}`
      const slug_value_2 = `multi-user-2${generateRandomString()}`
      // Create workspace as user1
      await createWorkspace({
        name: "Multi-User Test 1",
        slug: slug_value,
        ownerId: testUser1.id,
      });

      // Create workspace as user2  
      const workspace2 = await createWorkspace({
        name: "Multi-User Test 2",
        slug: slug_value_2,
        ownerId: testUser2.id,
      });

      // Add user1 as member to workspace2
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace2.id,
          userId: testUser1.id,
          role: "PM",
        },
      });

      // Test user1's workspaces (should see both)
      const user1Workspaces = await getUserWorkspaces(testUser1.id);
      expect(user1Workspaces).toHaveLength(2);
      expect(user1Workspaces.find(w => w.slug === slug_value)?.userRole).toBe("OWNER");
      expect(user1Workspaces.find(w => w.slug === slug_value_2)?.userRole).toBe("PM");

      // Test user2's workspaces (should see only owned)
      const user2Workspaces = await getUserWorkspaces(testUser2.id);
      expect(user2Workspaces).toHaveLength(1);
      expect(user2Workspaces[0].slug).toBe(slug_value_2);
      expect(user2Workspaces[0].userRole).toBe("OWNER");

      // Test user3's workspaces (should see none)
      const user3Workspaces = await getUserWorkspaces(testUser3.id);
      expect(user3Workspaces).toHaveLength(0);
    });
  });
});
