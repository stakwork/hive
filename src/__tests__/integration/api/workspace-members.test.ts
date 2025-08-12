import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { GET, POST } from "@/app/api/workspaces/[slug]/members/route";
import { PATCH, DELETE } from "@/app/api/workspaces/[slug]/members/[userId]/route";
import {
  getWorkspaceMembers,
  addWorkspaceMember,
  updateWorkspaceMemberRole,
  removeWorkspaceMember,
  validateWorkspaceAccess,
  getWorkspaceBySlug,
} from "@/services/workspace";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  getWorkspaceMembers: vi.fn(),
  addWorkspaceMember: vi.fn(),
  updateWorkspaceMemberRole: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  validateWorkspaceAccess: vi.fn(),
  getWorkspaceBySlug: vi.fn(),
}));

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockGetWorkspaceMembers = getWorkspaceMembers as vi.MockedFunction<typeof getWorkspaceMembers>;
const mockAddWorkspaceMember = addWorkspaceMember as vi.MockedFunction<typeof addWorkspaceMember>;
const mockValidateWorkspaceAccess = validateWorkspaceAccess as vi.MockedFunction<typeof validateWorkspaceAccess>;
const mockGetWorkspaceBySlug = getWorkspaceBySlug as vi.MockedFunction<typeof getWorkspaceBySlug>;
const mockUpdateWorkspaceMemberRole = updateWorkspaceMemberRole as vi.MockedFunction<typeof updateWorkspaceMemberRole>;
const mockRemoveWorkspaceMember = removeWorkspaceMember as vi.MockedFunction<typeof removeWorkspaceMember>;

describe("Workspace Members API Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/workspaces/[slug]/members", () => {
    test("should return 401 when user not authenticated", async () => {
      mockGetServerSession.mockResolvedValue(null);
      
      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/members");
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: "Unauthorized" });
    });

    test("should return workspace members successfully", async () => {
      const mockMembers = [
        {
          id: "member1",
          userId: "user2",
          role: "DEVELOPER",
          joinedAt: "2024-01-01T00:00:00.000Z",
          user: {
            id: "user2",
            name: "John Doe",
            email: "john@example.com",
            image: "https://github.com/john.png",
            github: {
              username: "johndoe",
              name: "John Doe",
              bio: "Developer",
              publicRepos: 25,
              followers: 100,
            },
          },
        },
      ];

      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", email: "user@example.com" },
      });
      mockGetWorkspaceBySlug.mockResolvedValue({
        id: "workspace1",
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: "user1",
        userRole: "OWNER",
      } as any);
      mockGetWorkspaceMembers.mockResolvedValue({
        members: mockMembers,
        owner: {
          id: "owner1",
          userId: "owner1", 
          role: "OWNER",
          joinedAt: new Date("2024-01-01").toISOString(),
          user: {
            id: "owner1",
            name: "Owner User",
            email: "owner@example.com",
            image: null,
            github: {
              username: "owneruser",
              name: "Owner User", 
              bio: null,
              publicRepos: 0,
              followers: 0,
            },
          },
        },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/members");
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.members).toHaveLength(1);
      expect(data.members[0].user.github.username).toBe("johndoe");
      expect(data.owner).toBeDefined();
      expect(data.owner.role).toBe("OWNER");
    });

    test("should return 404 for non-existent workspace", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", email: "user@example.com" },
      });
      mockGetWorkspaceBySlug.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/workspaces/nonexistent/members");
      const params = Promise.resolve({ slug: "nonexistent" });

      const response = await GET(request, { params });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: "Workspace not found or access denied" });
    });
  });

  describe("POST /api/workspaces/[slug]/members", () => {
    test("should add workspace member successfully", async () => {
      const mockCreatedMember = {
        id: "member1",
        userId: "user2",
        role: "DEVELOPER",
        joinedAt: "2024-01-01T00:00:00.000Z",
        user: {
          id: "user2",
          name: "John Doe",
          email: "john@example.com",
          image: "https://github.com/john.png",
          github: {
            username: "johndoe",
            name: "John Doe",
            bio: "Developer",
            publicRepos: 25,
            followers: 100,
          },
        },
      };

      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", email: "user@example.com" },
      });
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
        workspace: { id: "workspace1", name: "Test" },
      } as any);
      mockAddWorkspaceMember.mockResolvedValue(mockCreatedMember as any);

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/members", {
        method: "POST",
        body: JSON.stringify({
          githubUsername: "johndoe",
          role: "DEVELOPER",
        }),
      });
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.member.role).toBe("DEVELOPER");
      expect(data.member.user.github.username).toBe("johndoe");
    });

    test("should return 400 for missing required fields", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", email: "user@example.com" },
      });

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/members", {
        method: "POST",
        body: JSON.stringify({
          githubUsername: "johndoe",
          // Missing role
        }),
      });
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("required");
    });

    test("should return 403 for insufficient permissions", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", email: "user@example.com" },
      });
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canAdmin: false, // Insufficient permissions
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/members", {
        method: "POST",
        body: JSON.stringify({
          githubUsername: "johndoe",
          role: "DEVELOPER",
        }),
      });
      const params = Promise.resolve({ slug: "test-workspace" });

      const response = await POST(request, { params });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Admin access required");
    });
  });

  describe("PATCH /api/workspaces/[slug]/members/[userId]", () => {
    test("should update member role successfully", async () => {
      const mockUpdatedMember = {
        id: "member1",
        userId: "user2",
        role: "PM",
        joinedAt: "2024-01-01T00:00:00.000Z",
        user: {
          id: "user2",
          name: "John Doe",
          email: "john@example.com",
          image: "https://github.com/john.png",
          github: {
            username: "johndoe",
            name: "John Doe",
            bio: "Developer",
            publicRepos: 25,
            followers: 100,
          },
        },
      };

      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", email: "user@example.com" },
      });
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
        workspace: { id: "workspace1", name: "Test" },
      } as any);
      mockUpdateWorkspaceMemberRole.mockResolvedValue(mockUpdatedMember as any);

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/members/user2", {
        method: "PATCH",
        body: JSON.stringify({ role: "PM" }),
      });
      const params = Promise.resolve({ slug: "test-workspace", userId: "user2" });

      const response = await PATCH(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.member.role).toBe("PM");
    });

    test("should return 403 for insufficient permissions", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", email: "user@example.com" },
      });
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canAdmin: false,
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/members/user2", {
        method: "PATCH",
        body: JSON.stringify({ role: "PM" }),
      });
      const params = Promise.resolve({ slug: "test-workspace", userId: "user2" });

      const response = await PATCH(request, { params });

      expect(response.status).toBe(403);
    });
  });

  describe("DELETE /api/workspaces/[slug]/members/[userId]", () => {
    test("should remove member successfully", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", email: "user@example.com" },
      });
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canAdmin: true,
        workspace: { id: "workspace1", name: "Test" },
      } as any);
      mockRemoveWorkspaceMember.mockResolvedValue(undefined);

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/members/user2", {
        method: "DELETE",
      });
      const params = Promise.resolve({ slug: "test-workspace", userId: "user2" });

      const response = await DELETE(request, { params });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("should return 403 for insufficient permissions", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: "user1", email: "user@example.com" },
      });
      mockValidateWorkspaceAccess.mockResolvedValue({
        hasAccess: true,
        canAdmin: false,
      } as any);

      const request = new NextRequest("http://localhost:3000/api/workspaces/test-workspace/members/user2", {
        method: "DELETE",
      });
      const params = Promise.resolve({ slug: "test-workspace", userId: "user2" });

      const response = await DELETE(request, { params });

      expect(response.status).toBe(403);
    });
  });
});