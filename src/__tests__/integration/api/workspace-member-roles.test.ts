import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkspaceRole } from "@prisma/client";
import { AssignableMemberRoles } from "@/lib/auth/roles";
import { createTestWorkspace, createTestUser, cleanup } from "../../utils/test-helpers";

describe("Workspace Member Role API Validation", () => {
  let testUserId: string;
  let testWorkspaceSlug: string;
  let targetUserId: string;

  beforeEach(async () => {
    // Create test users and workspace
    const testUser = await createTestUser();
    const targetUser = await createTestUser();
    testUserId = testUser.id;
    targetUserId = targetUser.id;
    
    const workspace = await createTestWorkspace(testUserId);
    testWorkspaceSlug = workspace.slug;
  });

  afterEach(async () => {
    await cleanup();
  });

  describe("POST /api/workspaces/[slug]/members - Add Member", () => {
    it("should accept all assignable roles", async () => {
      for (const role of AssignableMemberRoles) {
        const response = await fetch(`/api/workspaces/${testWorkspaceSlug}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            githubUsername: "testuser",
            role: role,
          }),
        });

        // Note: This test focuses on role validation, not full endpoint functionality
        // A 404 or other error is acceptable as long as it's not a 400 "Invalid role"
        if (response.status === 400) {
          const errorData = await response.json();
          expect(errorData.error).not.toBe("Invalid role");
        }
      }
    });

    it("should reject OWNER role", async () => {
      const response = await fetch(`/api/workspaces/${testWorkspaceSlug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUsername: "testuser",
          role: WorkspaceRole.OWNER,
        }),
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");
    });

    it("should reject STAKEHOLDER role", async () => {
      const response = await fetch(`/api/workspaces/${testWorkspaceSlug}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUsername: "testuser",
          role: WorkspaceRole.STAKEHOLDER,
        }),
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");
    });

    it("should reject invalid role strings", async () => {
      const invalidRoles = ["INVALID_ROLE", "", "MANAGER", "USER", "MODERATOR"];
      
      for (const role of invalidRoles) {
        const response = await fetch(`/api/workspaces/${testWorkspaceSlug}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            githubUsername: "testuser",
            role: role,
          }),
        });

        expect(response.status).toBe(400);
        const errorData = await response.json();
        expect(errorData.error).toBe("Invalid role");
      }
    });
  });

  describe("PATCH /api/workspaces/[slug]/members/[userId] - Update Member Role", () => {
    it("should accept all assignable roles", async () => {
      for (const role of AssignableMemberRoles) {
        const response = await fetch(`/api/workspaces/${testWorkspaceSlug}/members/${targetUserId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        });

        // Note: This test focuses on role validation, not full endpoint functionality
        // A 404 or other error is acceptable as long as it's not a 400 "Invalid role"
        if (response.status === 400) {
          const errorData = await response.json();
          expect(errorData.error).not.toBe("Invalid role");
        }
      }
    });

    it("should reject OWNER role", async () => {
      const response = await fetch(`/api/workspaces/${testWorkspaceSlug}/members/${targetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: WorkspaceRole.OWNER }),
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");
    });

    it("should reject STAKEHOLDER role", async () => {
      const response = await fetch(`/api/workspaces/${testWorkspaceSlug}/members/${targetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: WorkspaceRole.STAKEHOLDER }),
      });

      expect(response.status).toBe(400);
      const errorData = await response.json();
      expect(errorData.error).toBe("Invalid role");
    });

    it("should reject invalid role strings", async () => {
      const invalidRoles = ["INVALID_ROLE", "", "MANAGER", "USER", "MODERATOR"];
      
      for (const role of invalidRoles) {
        const response = await fetch(`/api/workspaces/${testWorkspaceSlug}/members/${targetUserId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        });

        expect(response.status).toBe(400);
        const errorData = await response.json();
        expect(errorData.error).toBe("Invalid role");
      }
    });
  });
});