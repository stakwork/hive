import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/workspaces/[slug]/members/route";
import { PATCH, DELETE } from "@/app/api/workspaces/[slug]/members/[userId]/route";
import { WorkspaceRole } from "@prisma/client";
import { db } from "@/lib/db";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import {
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
  expectForbidden,
  expectError,
  expectMemberLeft,
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createAuthenticatedPatchRequest,
  createAuthenticatedDeleteRequest,
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
      const { ownerUser, workspace } = await createTestWorkspaceWithUsers();

      // Member already created by createTestWorkspaceScenario (no need to create again)

      const request = createAuthenticatedGetRequest(
        `/api/workspaces/${workspace.slug}/members`,
        { id: ownerUser.id, email: ownerUser.email || "", name: ownerUser.name || "" }
      );
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

      const request = new NextRequest(`http://localhost:3000/api/workspaces/${workspace.slug}/members`);
      const response = await GET(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectUnauthorized(response);
    });

    test("should return 404 for non-existent workspace", async () => {
      const { ownerUser } = await createTestWorkspaceWithUsers();

      const request = createAuthenticatedGetRequest(
        "/api/workspaces/nonexistent/members",
        { id: ownerUser.id, email: ownerUser.email || "", name: ownerUser.name || "" }
      );
      const response = await GET(request, { params: Promise.resolve({ slug: "nonexistent" }) });

      await expectNotFound(response, "Workspace not found or access denied");
    });
  });

  describe("POST /api/workspaces/[slug]/members", () => {
    test("should add workspace member successfully with real database operations", async () => {
      const { ownerUser, workspace, targetUser } = await createTestWorkspaceWithUsers();

      const request = createAuthenticatedPostRequest(
        `/api/workspaces/${workspace.slug}/members`,
        {
          githubUsername: "targetuser",
          role: WorkspaceRole.DEVELOPER,
        },
        { id: ownerUser.id, email: ownerUser.email || "", name: ownerUser.name || "" }
      );
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

      const request = createAuthenticatedPostRequest(
        `/api/workspaces/${workspace.slug}/members`,
        {
          githubUsername: "targetuser",
          // Missing role
        },
        { id: ownerUser.id, email: ownerUser.email || "", name: ownerUser.name || "" }
      );
      const response = await POST(request, { params: Promise.resolve({ slug: workspace.slug }) });

      await expectError(response, "required", 400);

      // Verify no NEW member was added (still just the 1 existing member)
      const membersInDb = await db.workspaceMember.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(membersInDb).toHaveLength(1);
    });

    test("should return 403 for insufficient permissions", async () => {
      const { workspace } = await createTestWorkspaceWithUsers();

      // Create non-admin user
      const nonAdminUser = await createTestUser({ name: "Non Admin User" });

      const request = createAuthenticatedPostRequest(
        `/api/workspaces/${workspace.slug}/members`,
        {
          githubUsername: "targetuser",
          role: WorkspaceRole.DEVELOPER,
        },
        { id: nonAdminUser.id, email: nonAdminUser.email || "", name: nonAdminUser.name || "" }
      );
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

      const request = createAuthenticatedPostRequest(
        `/api/workspaces/${workspace.slug}/members`,
        {
          githubUsername: "nonexistentuser",
          role: WorkspaceRole.DEVELOPER,
        },
        { id: ownerUser.id, email: ownerUser.email || "", name: ownerUser.name || "" }
      );
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

      const request = createAuthenticatedPatchRequest(
        `/api/workspaces/${workspace.slug}/members/${memberUser.id}`,
        { role: WorkspaceRole.PM },
        { id: ownerUser.id, email: ownerUser.email || "", name: ownerUser.name || "" }
      );
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

      const request = createAuthenticatedPatchRequest(
        `/api/workspaces/${workspace.slug}/members/${memberUser.id}`,
        { role: WorkspaceRole.PM },
        { id: nonAdminUser.id, email: nonAdminUser.email || "", name: nonAdminUser.name || "" }
      );
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

      const request = createAuthenticatedPatchRequest(
        `/api/workspaces/${workspace.slug}/members/${targetUser.id}`,
        { role: WorkspaceRole.PM },
        { id: ownerUser.id, email: ownerUser.email || "", name: ownerUser.name || "" }
      );
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

      const request = createAuthenticatedDeleteRequest(
        `/api/workspaces/${workspace.slug}/members/${memberUser.id}`,
        { id: ownerUser.id, email: ownerUser.email || "", name: ownerUser.name || "" }
      );
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

      const request = createAuthenticatedDeleteRequest(
        `/api/workspaces/${workspace.slug}/members/${memberUser.id}`,
        { id: nonAdminUser.id, email: nonAdminUser.email || "", name: nonAdminUser.name || "" }
      );
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

      const request = createAuthenticatedDeleteRequest(
        `/api/workspaces/${workspace.slug}/members/${ownerUser.id}`,
        { id: ownerUser.id, email: ownerUser.email || "", name: ownerUser.name || "" }
      );
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

      const request = createAuthenticatedDeleteRequest(
        `/api/workspaces/${workspace.slug}/members/${targetUser.id}`,
        { id: ownerUser.id, email: ownerUser.email || "", name: ownerUser.name || "" }
      );
      const response = await DELETE(request, {
        params: Promise.resolve({ slug: workspace.slug, userId: targetUser.id })
      });

      await expectNotFound(response, "Member not found");
    });
  });
});