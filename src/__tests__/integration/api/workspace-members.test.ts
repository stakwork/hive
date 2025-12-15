import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET, POST } from "@/app/api/workspaces/[slug]/members/route";
import { PATCH, DELETE } from "@/app/api/workspaces/[slug]/members/[userId]/route";
import { WorkspaceRole } from "@prisma/client";
import { db } from "@/lib/db";
import { createTestWorkspaceScenario, createTestMembership } from "@/__tests__/support/factories/workspace.factory";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
  expectForbidden,
  expectError,
  expectMemberLeft,
  generateUniqueId,
  createGetRequest,
  createPostRequest,
  createPatchRequest,
  createDeleteRequest,
  getMockedSession,
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

describe("Workspace Members API Integration Tests", () => {
  async function createTestWorkspaceWithUsers() {
    const scenario = await createTestWorkspaceScenario({
      owner: {
        name: "Owner User",
      },
      members: [
        {
          user: { name: "Member User" },
          role: "DEVELOPER",
          withGitHubAuth: true,
          githubUsername: "testuser"
        },
      ],
    });

    const targetUser = await createTestUser({
      name: "Target User",
      withGitHubAuth: true,
      githubUsername: "targetuser",
    });

    return {
      ownerUser: scenario.owner,
      workspace: scenario.workspace,
      memberUser: scenario.members[0],
      targetUser,
    };
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/[slug]/members", () => {
    test("should return workspace members with real database operations", async () => {
      const { ownerUser, workspace, memberUser } = await createTestWorkspaceWithUsers();

      // Member already created by createTestWorkspaceScenario (no need to create again)

      // Mock session with owner user
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`);
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response);
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
      
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());
      
      const request = createGetRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`);
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectUnauthorized(response);
    });

    test("should return 404 for non-existent workspace", async () => {
      const { ownerUser } = await createTestWorkspaceWithUsers();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createGetRequest("http://localhost:3000/api/workspaces/nonexistent/members");
      const response = await GET(request, { params: Promise.resolve({ slug: "nonexistent" }) });

      await expectNotFound(response, "Workspace not found or access denied");
    });
  });

  describe("POST /api/workspaces/[slug]/members", () => {
    test("should add workspace member successfully with real database operations", async () => {
      const { ownerUser, workspace, targetUser } = await createTestWorkspaceWithUsers();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`, {
        githubUsername: "targetuser",
        role: WorkspaceRole.DEVELOPER,
      });
      const response = await POST(request, { params: Promise.resolve({ slug: workspace.slug }) });

      const data = await expectSuccess(response, 201);
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
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`, {
        githubUsername: "targetuser",
        // Missing role
      });
      const response = await POST(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectError(response, "required", 400);

      // Verify no NEW member was added (still just the 1 existing member)
      const membersInDb = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(membersInDb).toHaveLength(1);
    });

    test("should return 403 for insufficient permissions", async () => {
      const { workspace, memberUser, targetUser } = await createTestWorkspaceWithUsers();

      // Create non-admin user
      const nonAdminUser = await createTestUser({ name: "Non Admin User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonAdminUser));

      const request = createPostRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`, {
        githubUsername: "targetuser",
        role: WorkspaceRole.DEVELOPER,
      });
      const response = await POST(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectForbidden(response, "Admin access required");

      // Verify no NEW member was added (still just the 1 existing member)
      const membersInDb = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(membersInDb).toHaveLength(1);
    });

    test("should prevent adding non-existent GitHub user", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`, {
        githubUsername: "nonexistentuser",
        role: WorkspaceRole.DEVELOPER,
      });
      const response = await POST(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectNotFound(response, "not found");

      // Verify no NEW member was added (still just the 1 existing member)
      const membersInDb = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(membersInDb).toHaveLength(1);
    });
  });

  describe("PATCH /api/workspaces/[slug]/members/[userId]", () => {
    test("should update member role successfully with real database operations", async () => {
      const { ownerUser, workspace, memberUser } = await createTestWorkspaceWithUsers();

      // Member already created by createTestWorkspaceScenario

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPatchRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${memberUser.id}`, {
        role: WorkspaceRole.PM,
      });
      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug, userId: memberUser.id })
      });

      const data = await expectSuccess(response);
      expect(data.member.role).toBe("PM");

      // Verify role was actually updated in database
      const memberInDb = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: memberUser.id },
      });
      expect(memberInDb?.role).toBe(WorkspaceRole.PM);
    });

    test("should return 403 for insufficient permissions", async () => {
      const { workspace, memberUser } = await createTestWorkspaceWithUsers();

      // Member already created by createTestWorkspaceScenario

      // Create non-admin user
      const nonAdminUser = await createTestUser({ name: "Non Admin User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonAdminUser));

      const request = createPatchRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${memberUser.id}`, {
        role: WorkspaceRole.PM,
      });
      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug, userId: memberUser.id })
      });

      await expectForbidden(response);

      // Verify role was not changed in database
      const memberInDb = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: memberUser.id },
      });
      expect(memberInDb?.role).toBe(WorkspaceRole.DEVELOPER);
    });

    test("should return 404 for non-existent member", async () => {
      const { ownerUser, workspace, targetUser } = await createTestWorkspaceWithUsers();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPatchRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${targetUser.id}`, {
        role: WorkspaceRole.PM,
      });
      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
      });

      await expectNotFound(response, "Member not found");
    });
  });

  describe("DELETE /api/workspaces/[slug]/members/[userId]", () => {
    test("should remove member successfully with real database operations", async () => {
      const { ownerUser, workspace, memberUser } = await createTestWorkspaceWithUsers();

      // Member already created by createTestWorkspaceScenario

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${memberUser.id}`);
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, userId: memberUser.id })
      });

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);

      // Verify member was soft-deleted in database
      await expectMemberLeft(workspace.id, memberUser.id);
    });

    test("should return 403 for insufficient permissions", async () => {
      const { workspace, memberUser } = await createTestWorkspaceWithUsers();

      // Member already created by createTestWorkspaceScenario

      // Create non-admin user
      const nonAdminUser = await createTestUser({ name: "Non Admin User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonAdminUser));

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${memberUser.id}`);
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, userId: memberUser.id })
      });

      await expectForbidden(response);

      // Verify member was not removed from database
      const memberInDb = await db.workspaceMember.findFirst({
        where: { workspaceId: workspace.id, userId: memberUser.id, leftAt: null },
      });
      expect(memberInDb).toBeTruthy();
    });

    test("should prevent removing workspace owner", async () => {
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${ownerUser.id}`);
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, userId: ownerUser.id })
      });

      await expectError(response, "Cannot remove workspace owner", 400);

      // Verify workspace still exists and owner is unchanged
      const workspaceInDb = await db.workspace.findUnique({
        where: { id: workspace.id },
      });
      expect(workspaceInDb?.ownerId).toBe(ownerUser.id);
    });

    test("should return 404 for non-existent member", async () => {
      const { ownerUser, workspace, targetUser } = await createTestWorkspaceWithUsers();
      
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createDeleteRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members/${targetUser.id}`);
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
      });

      await expectNotFound(response, "Member not found");
    });
  });
});