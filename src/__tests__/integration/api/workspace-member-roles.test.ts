import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/workspaces/[slug]/members/route";
import { PATCH } from "@/app/api/workspaces/[slug]/members/[userId]/route";
import { WorkspaceRole } from "@prisma/client";
import { AssignableMemberRoles } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { createTestWorkspaceScenario } from "@/__tests__/fixtures/workspace";
import { createTestUser } from "@/__tests__/fixtures/user";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectError,
  expectUnauthorized,
  expectForbidden,
  generateUniqueId,
  createPostRequest,
  createPatchRequest,
  getMockedSession,
} from "@/__tests__/helpers";

// Mock GitHub API calls for addWorkspaceMember (external service)
vi.mock("@/services/github", () => ({
  fetchGitHubUser: vi.fn().mockResolvedValue({
    id: "12345",
    login: "testuser",
    name: "Test User",
    email: "test@example.com",
    avatar_url: "https://github.com/avatar",
    bio: "Test bio",
    public_repos: 10,
    followers: 5,
  }),
}));

describe("Workspace Member Role API Integration Tests", () => {
  async function createTestWorkspaceWithAdminUser() {
    const scenario = await createTestWorkspaceScenario();

    const targetUser = await createTestUser({
      name: "Target User",
      withGitHubAuth: true,
      githubUsername: "testuser",
    });

    return {
      adminUser: scenario.owner,
      workspace: scenario.workspace,
      targetUser,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("POST /api/workspaces/[slug]/members - Add Member Role Validation", () => {
    test("should accept all assignable roles with real database operations", async () => {
      for (const role of AssignableMemberRoles) {
        const { adminUser, workspace } = await createTestWorkspaceWithAdminUser();
        
        // Mock session with real admin user
        getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

        const request = createPostRequest(`http://localhost/api/workspaces/${workspace.slug}/members`, {
          githubUsername: "testuser",
          role: role,
        });

        const response = await POST(request, { 
          params: Promise.resolve({ slug: workspace.slug })
        });

        // Should not be rejected for invalid role
        if (response.status === 400) {
          const errorData = await response.json();
          expect(errorData.error).not.toBe("Invalid role");
        }

        // Verify workspace and admin user exist in database
        const workspaceInDb = await db.workspace.findUnique({
          where: { id: workspace.id },
        });
        expect(workspaceInDb).toBeTruthy();
        expect(workspaceInDb?.ownerId).toBe(adminUser.id);
      }
    });

    test("should reject OWNER role with real validation logic", async () => {
      const { adminUser, workspace } = await createTestWorkspaceWithAdminUser();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const request = createPostRequest(`http://localhost/api/workspaces/${workspace.slug}/members`, {
        githubUsername: "testuser",
        role: WorkspaceRole.OWNER,
      });

      const response = await POST(request, { 
        params: Promise.resolve({ slug: workspace.slug })
      });

      await expectError(response, "Invalid role", 400);

      // Verify no member was added to database
      const members = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(members).toHaveLength(0);
    });

    test("should reject STAKEHOLDER role with real validation logic", async () => {
      const { adminUser, workspace } = await createTestWorkspaceWithAdminUser();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const request = createPostRequest(`http://localhost/api/workspaces/${workspace.slug}/members`, {
        githubUsername: "testuser",
        role: WorkspaceRole.STAKEHOLDER,
      });

      const response = await POST(request, { 
        params: Promise.resolve({ slug: workspace.slug })
      });

      await expectError(response, "Invalid role", 400);

      // Verify no member was added to database
      const members = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(members).toHaveLength(0);
    });

    test("should reject invalid role strings with real validation", async () => {
      const invalidRoles = ["INVALID_ROLE", "MANAGER", "USER", "MODERATOR"];
      
      for (const role of invalidRoles) {
        const { adminUser, workspace } = await createTestWorkspaceWithAdminUser();
        
        getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

        const request = createPostRequest(`http://localhost/api/workspaces/${workspace.slug}/members`, {
          githubUsername: "testuser",
          role: role,
        });

        const response = await POST(request, { 
          params: Promise.resolve({ slug: workspace.slug })
        });

        await expectError(response, "Invalid role", 400);

        // Verify no member was added to database
        const members = await db.workspaceMember.findMany({
          where: { workspaceId: workspace.id },
        });
        expect(members).toHaveLength(0);
      }
    });

    test("should require authentication with real session validation", async () => {
      const { workspace } = await createTestWorkspaceWithAdminUser();
      
      // Mock no session
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(`http://localhost/api/workspaces/${workspace.slug}/members`, {
        githubUsername: "testuser",
        role: WorkspaceRole.DEVELOPER,
      });

      const response = await POST(request, { 
        params: Promise.resolve({ slug: workspace.slug })
      });

      await expectUnauthorized(response);
    });

    test("should require valid workspace access with real database lookup", async () => {
      const { adminUser } = await createTestWorkspaceWithAdminUser();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const request = createPostRequest("http://localhost/api/workspaces/nonexistent/members", {
        githubUsername: "testuser",
        role: WorkspaceRole.DEVELOPER,
      });

      const response = await POST(request, { 
        params: Promise.resolve({ slug: "nonexistent" })
      });

      await expectForbidden(response, "Admin access required");
    });
  });

  describe("PATCH /api/workspaces/[slug]/members/[userId] - Update Member Role Validation", () => {
    test("should accept all assignable roles for role updates", async () => {
      for (const role of AssignableMemberRoles) {
        const { adminUser, workspace, targetUser } = await createTestWorkspaceWithAdminUser();

        // First add user as a member with STAKEHOLDER role (not in AssignableMemberRoles)
        await db.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: targetUser.id,
            role: WorkspaceRole.STAKEHOLDER,
          },
        });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

        const request = createPatchRequest(`http://localhost/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
          role,
        });

        const response = await PATCH(request, { 
          params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
        });

        // Should not be rejected for invalid role
        if (response.status === 400) {
          const errorData = await response.json();
          expect(errorData.error).not.toBe("Invalid role");
        }

        // Verify member still exists in database
        const member = await db.workspaceMember.findFirst({
          where: { workspaceId: workspace.id, userId: targetUser.id },
        });
        expect(member).toBeTruthy();
      }
    });

    test("should reject OWNER role for role updates", async () => {
      const { adminUser, workspace, targetUser } = await createTestWorkspaceWithAdminUser();
      
      // Add user as a member first
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: targetUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const request = createPatchRequest(`http://localhost/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
        role: WorkspaceRole.OWNER,
      });

      const response = await PATCH(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
      });

      await expectError(response, "Invalid role", 400);

      // Verify original role was not changed in database
      const member = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: targetUser.id },
      });
      expect(member?.role).toBe(WorkspaceRole.DEVELOPER);
    });

    test("should reject STAKEHOLDER role for role updates", async () => {
      const { adminUser, workspace, targetUser } = await createTestWorkspaceWithAdminUser();
      
      // Add user as a member first
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: targetUser.id,
          role: WorkspaceRole.PM,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const request = createPatchRequest(`http://localhost/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
        role: WorkspaceRole.STAKEHOLDER,
      });

      const response = await PATCH(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
      });

      await expectError(response, "Invalid role", 400);

      // Verify original role was not changed in database
      const member = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: targetUser.id },
      });
      expect(member?.role).toBe(WorkspaceRole.PM);
    });

    test("should reject invalid role strings for updates", async () => {
      const invalidRoles = ["INVALID_ROLE", "MANAGER", "USER", "MODERATOR"];
      
      for (const role of invalidRoles) {
        const { adminUser, workspace, targetUser } = await createTestWorkspaceWithAdminUser();
        
        // Add user as a member first
        await db.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: targetUser.id,
            role: WorkspaceRole.DEVELOPER,
          },
        });

        getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

        const request = createPatchRequest(`http://localhost/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
          role,
        });

        const response = await PATCH(request, { 
          params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
        });

        await expectError(response, "Invalid role", 400);

        // Verify original role was not changed in database
        const member = await db.workspaceMember.findFirst({
          where: { workspaceId: workspace.id, userId: targetUser.id },
        });
        expect(member?.role).toBe(WorkspaceRole.DEVELOPER);
      }
    });

    test("should verify real permission checks for role updates", async () => {
      const { workspace, targetUser } = await createTestWorkspaceWithAdminUser();
      
      // Create a non-admin user
      const nonAdminUser = await db.user.create({
        data: {
          id: generateUniqueId("nonadmin"),
          email: `nonadmin-${generateUniqueId()}@example.com`,
          name: "Non Admin User",
        },
      });

      // Add target user as a member first
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: targetUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      // Mock session with non-admin user
      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonAdminUser));

      const request = createPatchRequest(`http://localhost/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
        role: WorkspaceRole.PM,
      });

      const response = await PATCH(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
      });

      await expectForbidden(response, "Admin access required");

      // Verify role was not changed in database
      const member = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: targetUser.id },
      });
      expect(member?.role).toBe(WorkspaceRole.DEVELOPER);
    });
  });
});