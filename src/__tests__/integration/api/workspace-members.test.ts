import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { GET, POST } from "@/app/api/workspaces/[slug]/members/route";
import { PATCH, DELETE } from "@/app/api/workspaces/[slug]/members/[userId]/route";
import { WorkspaceRole } from "@prisma/client";
import { db } from "@/lib/db";

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

describe("Workspace Members API Integration Tests", () => {
  async function createTestWorkspaceWithUsers() {
    // Use transaction to create all test data atomically
    return await db.$transaction(async (tx) => {
      // Create workspace owner with real database operations
      const ownerUser = await tx.user.create({
        data: {
          id: `owner-${Date.now()}-${Math.random()}`,
          email: `owner-${Date.now()}@example.com`,
          name: "Owner User",
        },
      });

      // Create workspace owned by owner
      const workspace = await tx.workspace.create({
        data: {
          name: `Test Workspace ${Date.now()}`,
          slug: `test-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          ownerId: ownerUser.id,
        },
      });

      // Create a regular member user
      const memberUser = await tx.user.create({
        data: {
          id: `member-${Date.now()}-${Math.random()}`,
          email: `member-${Date.now()}@example.com`,
          name: "Member User",
        },
      });

      // Create GitHub auth for member user (needed for member operations)
      await tx.gitHubAuth.create({
        data: {
          userId: memberUser.id,
          githubUserId: `github-${Date.now()}`,
          githubUsername: "testuser",
          name: "Test User",
          bio: "Test bio",
          publicRepos: 10,
          followers: 5,
        },
      });

      // Create target user for operations
      const targetUser = await tx.user.create({
        data: {
          id: `target-${Date.now()}-${Math.random()}`,
          email: `target-${Date.now()}@example.com`,
          name: "Target User",
        },
      });

      // Create GitHub auth for target user
      await tx.gitHubAuth.create({
        data: {
          userId: targetUser.id,
          githubUserId: `github-target-${Date.now()}`,
          githubUsername: "targetuser",
          name: "Target User",
          bio: "Target bio",
          publicRepos: 5,
          followers: 3,
        },
      });

      return { ownerUser, workspace, memberUser, targetUser };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/[slug]/members", () => {
    test("should return workspace members with real database operations", async () => {
      const { ownerUser, workspace, memberUser } = await createTestWorkspaceWithUsers();
      
      // Add member to workspace with real database operations
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: memberUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      // Mock session with owner user
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`);
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.members).toHaveLength(1);
      expect(data.members[0].user.name).toBe("Member User");
      expect(data.members[0].role).toBe("DEVELOPER");
      expect(data.owner).toBeDefined();
      expect(data.owner.role).toBe("OWNER");
      expect(data.owner.user.name).toBe("Owner User");

      // Verify data actually exists in database
      const membersInDb = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id, leftAt: null },
      });
      expect(membersInDb).toHaveLength(1);
      expect(membersInDb[0].role).toBe(WorkspaceRole.DEVELOPER);
    });

    test("should return 401 when user not authenticated", async () => {
      const { workspace } = await createTestWorkspaceWithUsers();
      
      mockGetServerSession.mockResolvedValue(null);
      
      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`);
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
    });

    test("should return 404 for non-existent workspace", async () => {
      const { ownerUser } = await createTestWorkspaceWithUsers();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest("http://localhost:3000/api/workspaces/nonexistent/members");
      const response = await GET(request, { params: Promise.resolve({ slug: "nonexistent" }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: "Workspace not found or access denied" });
    });
  });

  describe("POST /api/workspaces/[slug]/members", () => {
    test("should add workspace member successfully with real database operations", async () => {
      const { ownerUser, workspace, targetUser } = await createTestWorkspaceWithUsers();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`, {
        method: "POST",
        body: JSON.stringify({
          githubUsername: "targetuser",
          role: WorkspaceRole.DEVELOPER,
        }),
      });
      const response = await POST(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.member.role).toBe("DEVELOPER");
      expect(data.member.user.name).toBe("Target User");

      // Verify member was actually added to database
      const memberInDb = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: targetUser.id, leftAt: null },
      });
      expect(memberInDb).toBeTruthy();
      expect(memberInDb?.role).toBe(WorkspaceRole.DEVELOPER);
    });

    test("should return 400 for missing required fields", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`, {
        method: "POST",
        body: JSON.stringify({
          githubUsername: "targetuser",
          // Missing role
        }),
      });
      const response = await POST(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("required");

      // Verify no member was added to database
      const membersInDb = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(membersInDb).toHaveLength(0);
    });

    test("should return 403 for insufficient permissions", async () => {
      const { workspace, memberUser, targetUser } = await createTestWorkspaceWithUsers();
      
      // Create non-admin user
      const nonAdminUser = await db.user.create({
        data: {
          id: `nonadmin-${Date.now()}-${Math.random()}`,
          email: `nonadmin-${Date.now()}@example.com`,
          name: "Non Admin User",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: nonAdminUser.id, email: nonAdminUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`, {
        method: "POST",
        body: JSON.stringify({
          githubUsername: "targetuser",
          role: WorkspaceRole.DEVELOPER,
        }),
      });
      const response = await POST(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Admin access required");

      // Verify no member was added to database
      const membersInDb = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(membersInDb).toHaveLength(0);
    });

    test("should prevent adding non-existent GitHub user", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`, {
        method: "POST",
        body: JSON.stringify({
          githubUsername: "nonexistentuser",
          role: WorkspaceRole.DEVELOPER,
        }),
      });
      const response = await POST(request, { params: Promise.resolve({ slug: workspace.slug }) });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain("not found");

      // Verify no member was added to database
      const membersInDb = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(membersInDb).toHaveLength(0);
    });
  });

  describe("PATCH /api/workspaces/[slug]/members/[userId]", () => {
    test("should update member role successfully with real database operations", async () => {
      const { ownerUser, workspace, memberUser } = await createTestWorkspaceWithUsers();
      
      // Add member to workspace first
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: memberUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${memberUser.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: WorkspaceRole.PM }),
      });
      const response = await PATCH(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: memberUser.id })
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.member.role).toBe("PM");

      // Verify role was actually updated in database
      const memberInDb = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: memberUser.id },
      });
      expect(memberInDb?.role).toBe(WorkspaceRole.PM);
    });

    test("should return 403 for insufficient permissions", async () => {
      const { workspace, memberUser } = await createTestWorkspaceWithUsers();
      
      // Add member to workspace
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: memberUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      // Create non-admin user
      const nonAdminUser = await db.user.create({
        data: {
          id: `nonadmin-${Date.now()}-${Math.random()}`,
          email: `nonadmin-${Date.now()}@example.com`,
          name: "Non Admin User",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: nonAdminUser.id, email: nonAdminUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${memberUser.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: WorkspaceRole.PM }),
      });
      const response = await PATCH(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: memberUser.id })
      });

      expect(response.status).toBe(403);

      // Verify role was not changed in database
      const memberInDb = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: memberUser.id },
      });
      expect(memberInDb?.role).toBe(WorkspaceRole.DEVELOPER);
    });

    test("should return 404 for non-existent member", async () => {
      const { ownerUser, workspace, targetUser } = await createTestWorkspaceWithUsers();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: WorkspaceRole.PM }),
      });
      const response = await PATCH(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Member not found");
    });
  });

  describe("DELETE /api/workspaces/[slug]/members/[userId]", () => {
    test("should remove member successfully with real database operations", async () => {
      const { ownerUser, workspace, memberUser } = await createTestWorkspaceWithUsers();
      
      // Add member to workspace first
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: memberUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${memberUser.id}`, {
        method: "DELETE",
      });
      const response = await DELETE(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: memberUser.id })
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify member was soft-deleted in database (leftAt should be set)
      const memberInDb = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: memberUser.id },
      });
      expect(memberInDb?.leftAt).toBeTruthy();

      // Verify member is no longer active
      const activeMemberInDb = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: memberUser.id, leftAt: null },
      });
      expect(activeMemberInDb).toBeNull();
    });

    test("should return 403 for insufficient permissions", async () => {
      const { workspace, memberUser } = await createTestWorkspaceWithUsers();
      
      // Add member to workspace
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: memberUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      // Create non-admin user
      const nonAdminUser = await db.user.create({
        data: {
          id: `nonadmin-${Date.now()}-${Math.random()}`,
          email: `nonadmin-${Date.now()}@example.com`,
          name: "Non Admin User",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: nonAdminUser.id, email: nonAdminUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${memberUser.id}`, {
        method: "DELETE",
      });
      const response = await DELETE(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: memberUser.id })
      });

      expect(response.status).toBe(403);

      // Verify member was not removed from database
      const memberInDb = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: memberUser.id, leftAt: null },
      });
      expect(memberInDb).toBeTruthy();
    });

    test("should prevent removing workspace owner", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${ownerUser.id}`, {
        method: "DELETE",
      });
      const response = await DELETE(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: ownerUser.id })
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Cannot remove workspace owner");

      // Verify workspace still exists and owner is unchanged
      const workspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(workspaceInDb?.ownerId).toBe(ownerUser.id);
    });

    test("should return 404 for non-existent member", async () => {
      const { ownerUser, workspace, targetUser } = await createTestWorkspaceWithUsers();
      
      mockGetServerSession.mockResolvedValue({
        user: { id: ownerUser.id, email: ownerUser.email },
      });

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
        method: "DELETE",
      });
      const response = await DELETE(request, { 
        params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Member not found");
    });
  });
});