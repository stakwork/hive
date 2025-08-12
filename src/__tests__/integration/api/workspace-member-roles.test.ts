import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { POST } from "@/app/api/workspaces/[slug]/members/route";
import { PATCH } from "@/app/api/workspaces/[slug]/members/[userId]/route";
import { WorkspaceRole } from "@prisma/client";
import { AssignableMemberRoles } from "@/lib/auth/roles";
import { validateWorkspaceAccess, addWorkspaceMember, updateWorkspaceMemberRole } from "@/services/workspace";

// Mock dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
  addWorkspaceMember: vi.fn(),
  updateWorkspaceMemberRole: vi.fn(),
}));

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;
const mockValidateWorkspaceAccess = validateWorkspaceAccess as vi.MockedFunction<typeof validateWorkspaceAccess>;
const mockAddWorkspaceMember = addWorkspaceMember as vi.MockedFunction<typeof addWorkspaceMember>;
const mockUpdateWorkspaceMemberRole = updateWorkspaceMemberRole as vi.MockedFunction<typeof updateWorkspaceMemberRole>;

describe("Workspace Member Role API Validation", () => {
  const mockSession = {
    user: { id: "test-user-id" },
  };

  const mockWorkspaceAccess = {
    hasAccess: true,
    canAdmin: true,
    workspace: {
      id: "test-workspace-id",
      slug: "test-workspace",
    },
  };

  beforeEach(() => {
    // Setup mocks for successful authentication and access
    mockGetServerSession.mockResolvedValue(mockSession as any);
    mockValidateWorkspaceAccess.mockResolvedValue(mockWorkspaceAccess as any);
    mockAddWorkspaceMember.mockResolvedValue({ id: "test-member-id" } as any);
    mockUpdateWorkspaceMemberRole.mockResolvedValue({ id: "test-member-id" } as any);
    vi.clearAllMocks();
  });

  describe("POST /api/workspaces/[slug]/members - Add Member", () => {
    test("should accept all assignable roles", async () => {
      for (const role of AssignableMemberRoles) {
        const request = new NextRequest("http://localhost/api/workspaces/test-workspace/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            githubUsername: "testuser",
            role: role,
          }),
        });

        const response = await POST(request, { 
          params: Promise.resolve({ slug: "test-workspace" })
        });

        // Should not be rejected for invalid role
        if (response.status === 400) {
          const errorData = await response.json();
          expect(errorData.error).not.toBe("Invalid role");
        }
      }
    });

    test("should reject OWNER role", async () => {
      const request = new NextRequest("http://localhost/api/workspaces/test-workspace/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUsername: "testuser",
          role: WorkspaceRole.OWNER,
        }),
      });

      const response = await POST(request, { 
        params: Promise.resolve({ slug: "test-workspace" })
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");
    });

    test("should reject STAKEHOLDER role", async () => {
      const request = new NextRequest("http://localhost/api/workspaces/test-workspace/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUsername: "testuser",
          role: WorkspaceRole.STAKEHOLDER,
        }),
      });

      const response = await POST(request, { 
        params: Promise.resolve({ slug: "test-workspace" })
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");
    });

    test("should reject invalid role strings", async () => {
      const invalidRoles = ["INVALID_ROLE", "MANAGER", "USER", "MODERATOR"];
      
      for (const role of invalidRoles) {
        const request = new NextRequest("http://localhost/api/workspaces/test-workspace/members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            githubUsername: "testuser",
            role: role,
          }),
        });

        const response = await POST(request, { 
          params: Promise.resolve({ slug: "test-workspace" })
        });

        expect(response.status).toBe(400);
        const errorData = await response.json();
        expect(errorData.error).toBe("Invalid role");
      }
    });
  });

  describe("PATCH /api/workspaces/[slug]/members/[userId] - Update Member Role", () => {
    test("should accept all assignable roles", async () => {
      for (const role of AssignableMemberRoles) {
        const request = new NextRequest("http://localhost/api/workspaces/test-workspace/members/test-user-id", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        });

        const response = await PATCH(request, { 
          params: Promise.resolve({ slug: "test-workspace", userId: "test-user-id" })
        });

        // Should not be rejected for invalid role
        if (response.status === 400) {
          const errorData = await response.json();
          expect(errorData.error).not.toBe("Invalid role");
        }
      }
    });

    test("should reject OWNER role", async () => {
      const request = new NextRequest("http://localhost/api/workspaces/test-workspace/members/test-user-id", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: WorkspaceRole.OWNER }),
      });

      const response = await PATCH(request, { 
        params: Promise.resolve({ slug: "test-workspace", userId: "test-user-id" })
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");
    });

    test("should reject STAKEHOLDER role", async () => {
      const request = new NextRequest("http://localhost/api/workspaces/test-workspace/members/test-user-id", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: WorkspaceRole.STAKEHOLDER }),
      });

      const response = await PATCH(request, { 
        params: Promise.resolve({ slug: "test-workspace", userId: "test-user-id" })
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");
    });

    test("should reject invalid role strings", async () => {
      const invalidRoles = ["INVALID_ROLE", "MANAGER", "USER", "MODERATOR"];
      
      for (const role of invalidRoles) {
        const request = new NextRequest("http://localhost/api/workspaces/test-workspace/members/test-user-id", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        });

        const response = await PATCH(request, { 
          params: Promise.resolve({ slug: "test-workspace", userId: "test-user-id" })
        });

        expect(response.status).toBe(400);
        const errorData = await response.json();
        expect(errorData.error).toBe("Invalid role");
      }
    });
  });
});