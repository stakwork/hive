import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/workspaces/[slug]/members/route";
import { PATCH } from "@/app/api/workspaces/[slug]/members/[userId]/route";
import { WorkspaceRole } from "@prisma/client";
import { AssignableMemberRoles } from "@/lib/auth/roles";
import { db } from "@/lib/db";
import { createTestWorkspaceScenario } from "@/__tests__/fixtures/workspace";
import { createTestUser } from "@/__tests__/fixtures/user";

// Mock NextAuth - only external dependency
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

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

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;

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
        mockGetServerSession.mockResolvedValue({
          user: { id: adminUser.id, email: adminUser.email },
        });

        const request = new NextRequest(`http://localhost/api/workspaces/${workspace.slug}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            githubUsername: "testuser",
            role: role,
          }),
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
      
      mockGetServerSession.mockResolvedValue({
        user: { id: adminUser.id, email: adminUser.email },
      });

      const request = new NextRequest(`http://localhost/api/workspaces/${workspace.slug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUsername: "testuser",
          role: WorkspaceRole.OWNER,
        }),
      });

      const response = await POST(request, { 
        params: Promise.resolve({ slug: workspace.slug })
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");

      // Verify no member was added to database
      const members = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(members).toHaveLength(0);
    });

    test("should reject STAKEHOLDER role with real validation logic", async () => {
      const { adminUser, workspace } = await createTestWorkspaceWithAdminUser();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: adminUser.id, email: adminUser.email },
      });

      const request = new NextRequest(`http://localhost/api/workspaces/${workspace.slug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUsername: "testuser",
          role: WorkspaceRole.STAKEHOLDER,
        }),
      });

      const response = await POST(request, { 
        params: Promise.resolve({ slug: workspace.slug })
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");

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
        
        mockGetServerSession.mockResolvedValue({
          user: { id: adminUser.id, email: adminUser.email },
        });

        const request = new NextRequest(`http://localhost/api/workspaces/${workspace.slug}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            githubUsername: "testuser",
            role: role,
          }),
        });

        const response = await POST(request, { 
          params: Promise.resolve({ slug: workspace.slug })
        });

        expect(response.status).toBe(400);
        const errorData = await response.json();
        expect(errorData.error).toBe("Invalid role");

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
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest(`http://localhost/api/workspaces/${workspace.slug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUsername: "testuser",
          role: WorkspaceRole.DEVELOPER,
        }),
      });

      const response = await POST(request, { 
        params: Promise.resolve({ slug: workspace.slug })
      });

      expect(response.status).toBe(401);
      const errorData = await response.json();
      expect(errorData.error).toBe("Unauthorized");
    });

    test("should require valid workspace access with real database lookup", async () => {
      const { adminUser } = await createTestWorkspaceWithAdminUser();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: adminUser.id, email: adminUser.email },
      });

      const request = new NextRequest("http://localhost/api/workspaces/nonexistent/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUsername: "testuser",
          role: WorkspaceRole.DEVELOPER,
        }),
      });

      const response = await POST(request, { 
        params: Promise.resolve({ slug: "nonexistent" })
      });

      expect(response.status).toBe(403);
      const errorData = await response.json();
      expect(errorData.error).toBe("Admin access required");
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

        mockGetServerSession.mockResolvedValue({
          user: { id: adminUser.id, email: adminUser.email },
        });

        const request = new NextRequest(`http://localhost/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
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

      mockGetServerSession.mockResolvedValue({
        user: { id: adminUser.id, email: adminUser.email },
      });

      const request = new NextRequest(`http://localhost/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: WorkspaceRole.OWNER }),
      });

      const response = await PATCH(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");

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

      mockGetServerSession.mockResolvedValue({
        user: { id: adminUser.id, email: adminUser.email },
      });

      const request = new NextRequest(`http://localhost/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: WorkspaceRole.STAKEHOLDER }),
      });

      const response = await PATCH(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");

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

        mockGetServerSession.mockResolvedValue({
          user: { id: adminUser.id, email: adminUser.email },
        });

        const request = new NextRequest(`http://localhost/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        });

        const response = await PATCH(request, { 
          params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
        });

        expect(response.status).toBe(400);
        const errorData = await response.json();
        expect(errorData.error).toBe("Invalid role");

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
          id: `nonadmin-${Date.now()}-${Math.random()}`,
          email: `nonadmin-${Date.now()}@example.com`,
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
      mockGetServerSession.mockResolvedValue({
        user: { id: nonAdminUser.id, email: nonAdminUser.email },
      });

      const request = new NextRequest(`http://localhost/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: WorkspaceRole.PM }),
      });

      const response = await PATCH(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
      });

      expect(response.status).toBe(403);
      const errorData = await response.json();
      expect(errorData.error).toBe("Admin access required");

      // Verify role was not changed in database
      const member = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: targetUser.id },
      });
      expect(member?.role).toBe(WorkspaceRole.DEVELOPER);
    });
  });
});