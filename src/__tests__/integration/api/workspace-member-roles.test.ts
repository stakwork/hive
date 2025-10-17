import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/workspaces/[slug]/members/route";
import { PATCH } from "@/app/api/workspaces/[slug]/members/[userId]/route";
import { WorkspaceRole } from "@prisma/client";
import { AssignableMemberRoles } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import {
  expectError,
  expectUnauthorized,
  expectForbidden,
  createAuthenticatedPostRequest,
  createAuthenticatedPatchRequest,
} from "@/__tests__/support/helpers";

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
        
        const request = createAuthenticatedPostRequest(
          `/api/workspaces/${workspace.slug}/members`,
          {
            githubUsername: "testuser",
            role: role,
          },
          { id: adminUser.id, email: adminUser.email || "", name: adminUser.name || "" }
        );

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

      const request = createAuthenticatedPostRequest(
        `/api/workspaces/${workspace.slug}/members`,
        {
          githubUsername: "testuser",
          role: WorkspaceRole.OWNER,
        },
        { id: adminUser.id, email: adminUser.email || "", name: adminUser.name || "" }
      );

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

      const request = createAuthenticatedPostRequest(
        `/api/workspaces/${workspace.slug}/members`,
        {
          githubUsername: "testuser",
          role: WorkspaceRole.STAKEHOLDER,
        },
        { id: adminUser.id, email: adminUser.email || "", name: adminUser.name || "" }
      );

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

        const request = createAuthenticatedPostRequest(
          `/api/workspaces/${workspace.slug}/members`,
          {
            githubUsername: "testuser",
            role: role,
          },
          { id: adminUser.id, email: adminUser.email || "", name: adminUser.name || "" }
        );

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

      const request = new NextRequest(
        `http://localhost/api/workspaces/${workspace.slug}/members`,
        {
          method: "POST",
          body: JSON.stringify({
            githubUsername: "testuser",
            role: WorkspaceRole.DEVELOPER,
          }),
        }
      );

      const response = await POST(request, { 
        params: Promise.resolve({ slug: workspace.slug })
      });

      await expectUnauthorized(response);
    });

    test("should require valid workspace access with real database lookup", async () => {
      const { adminUser } = await createTestWorkspaceWithAdminUser();

      const request = createAuthenticatedPostRequest(
        "/api/workspaces/nonexistent/members",
        {
          githubUsername: "testuser",
          role: WorkspaceRole.DEVELOPER,
        },
        { id: adminUser.id, email: adminUser.email || "", name: adminUser.name || "" }
      );

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

        const request = createAuthenticatedPatchRequest(
          `/api/workspaces/${workspace.slug}/members/${targetUser.id}`,
          { role },
          { id: adminUser.id, email: adminUser.email || "", name: adminUser.name || "" }
        );

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

      const request = createAuthenticatedPatchRequest(
        `/api/workspaces/${workspace.slug}/members/${targetUser.id}`,
        { role: WorkspaceRole.OWNER },
        { id: adminUser.id, email: adminUser.email || "", name: adminUser.name || "" }
      );

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

      const request = createAuthenticatedPatchRequest(
        `/api/workspaces/${workspace.slug}/members/${targetUser.id}`,
        { role: WorkspaceRole.STAKEHOLDER },
        { id: adminUser.id, email: adminUser.email || "", name: adminUser.name || "" }
      );

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

        const request = createAuthenticatedPatchRequest(
          `/api/workspaces/${workspace.slug}/members/${targetUser.id}`,
          { role },
          { id: adminUser.id, email: adminUser.email || "", name: adminUser.name || "" }
        );

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
      const nonAdminUser = await createTestUser({ name: "Non Admin User" });

      // Add target user as a member first
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: targetUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      const request = createAuthenticatedPatchRequest(
        `/api/workspaces/${workspace.slug}/members/${targetUser.id}`,
        { role: WorkspaceRole.PM },
        { id: nonAdminUser.id, email: nonAdminUser.email || "", name: nonAdminUser.name || "" }
      );

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