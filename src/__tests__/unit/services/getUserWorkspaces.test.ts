import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { getUserWorkspaces } from "@/services/workspace";
import { db } from "@/lib/db";
import type { User, Workspace, WorkspaceMember } from "@prisma/client";
import { mockData } from "@/__tests__/utils/test-helpers";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findMany: vi.fn(),
    },
    workspaceMember: {
      findMany: vi.fn(),
    },
  },
}));

describe("getUserWorkspaces - Security and Sensitive Data Tests", () => {
  const testUserId = "test-user-123";
  const otherUserId = "other-user-456";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("Data Isolation and Access Control", () => {
    test("should only return workspaces accessible to the specific user", async () => {
      const ownedWorkspaces = [
        {
          id: "ws1",
          name: "User Owned Workspace",
          slug: "user-owned",
          ownerId: testUserId,
          description: "Sensitive workspace data",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
        },
      ];

      const memberships = [
        {
          userId: testUserId,
          role: "DEVELOPER",
          leftAt: null,
          workspace: {
            id: "ws2",
            name: "Member Workspace",
            slug: "member-workspace",
            ownerId: otherUserId,
            description: "Workspace where user is member",
            createdAt: new Date("2024-01-02"),
            updatedAt: new Date("2024-01-02"),
            deleted: false,
          },
        },
      ];

      const memberCounts = [
        { workspaceId: "ws1" }, // 1 member in ws1
        { workspaceId: "ws2" }, // 1 member in ws2
        { workspaceId: "ws2" }, // 2 members in ws2
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(memberships) // First call for memberships
        .mockResolvedValueOnce(memberCounts); // Second call for member counts

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(2);
      
      // Verify query only targets the specific user
      expect(db.workspace.findMany).toHaveBeenCalledWith({
        where: {
          ownerId: testUserId,
          deleted: false,
        },
      });

      expect(db.workspaceMember.findMany).toHaveBeenCalledWith({
        where: {
          userId: testUserId,
          leftAt: null,
        },
        include: {
          workspace: true,
        },
      });

      // Verify owned workspace has OWNER role
      const ownedWorkspace = result.find(w => w.id === "ws1");
      expect(ownedWorkspace?.userRole).toBe("OWNER");
      expect(ownedWorkspace?.ownerId).toBe(testUserId);

      // Verify member workspace has correct role
      const memberWorkspace = result.find(w => w.id === "ws2");
      expect(memberWorkspace?.userRole).toBe("DEVELOPER");
      expect(memberWorkspace?.ownerId).toBe(otherUserId);
    });

    test("should properly filter out deleted workspaces to prevent data leakage", async () => {
      const ownedWorkspaces = [
        {
          id: "ws-active",
          name: "Active Workspace",
          slug: "active-workspace",
          ownerId: testUserId,
          description: "Active workspace",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
        },
      ];

      const memberships = [
        {
          userId: testUserId,
          role: "ADMIN",
          leftAt: null,
          workspace: {
            id: "ws-deleted",
            name: "Deleted Workspace",
            slug: "deleted-workspace",
            ownerId: otherUserId,
            description: "Should not appear in results",
            createdAt: new Date("2024-01-02"),
            updatedAt: new Date("2024-01-02"),
            deleted: true, // This should be filtered out
          },
        },
        {
          userId: testUserId,
          role: "DEVELOPER",
          leftAt: null,
          workspace: {
            id: "ws-member",
            name: "Member Workspace",
            slug: "member-workspace",
            ownerId: otherUserId,
            description: "Active member workspace",
            createdAt: new Date("2024-01-03"),
            updatedAt: new Date("2024-01-03"),
            deleted: false,
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(memberships)
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(testUserId);

      // Should only return 2 workspaces (1 owned + 1 non-deleted member workspace)
      expect(result).toHaveLength(2);
      expect(result.map(w => w.id)).not.toContain("ws-deleted");
      expect(result.map(w => w.id)).toContain("ws-active");
      expect(result.map(w => w.id)).toContain("ws-member");
    });

    test("should not expose sensitive information from other users' workspaces", async () => {
      const memberships = [
        {
          userId: testUserId,
          role: "VIEWER", // Limited access role
          leftAt: null,
          workspace: {
            id: "ws-restricted",
            name: "Restricted Workspace",
            slug: "restricted-workspace",
            ownerId: otherUserId,
            description: "Contains sensitive data",
            createdAt: new Date("2024-01-01"),
            updatedAt: new Date("2024-01-01"),
            deleted: false,
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(memberships)
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(1);
      const workspace = result[0];

      // Should contain workspace data but with proper role assignment
      expect(workspace.userRole).toBe("VIEWER");
      expect(workspace.ownerId).toBe(otherUserId);
      expect(workspace.id).toBe("ws-restricted");
      
      // Ensure the returned data structure doesn't leak sensitive internal details
      expect(workspace).toHaveProperty("name");
      expect(workspace).toHaveProperty("slug");
      expect(workspace).toHaveProperty("description");
      expect(workspace).toHaveProperty("createdAt");
      expect(workspace).toHaveProperty("updatedAt");
      expect(workspace).toHaveProperty("memberCount");
      
      // Verify no additional sensitive properties are exposed
      expect(workspace).not.toHaveProperty("stakworkApiKey");
      expect(workspace).not.toHaveProperty("internalNotes");
    });
  });

  describe("Role-Based Access Control", () => {
    test("should correctly assign OWNER role for user-owned workspaces", async () => {
      const ownedWorkspaces = [
        mockData.workspace({
          id: "owned-ws",
          ownerId: testUserId,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        }),
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(1);
      expect(result[0].userRole).toBe("OWNER");
      expect(result[0].ownerId).toBe(testUserId);
    });

    test("should correctly preserve member roles for non-owned workspaces", async () => {
      const roles = ["ADMIN", "PM", "DEVELOPER", "STAKEHOLDER", "VIEWER"] as const;
      const memberships = roles.map((role, index) => ({
        userId: testUserId,
        role,
        leftAt: null,
        workspace: {
          id: `ws-${role.toLowerCase()}`,
          name: `${role} Workspace`,
          slug: `${role.toLowerCase()}-workspace`,
          ownerId: `owner-${index}`,
          description: `Workspace where user has ${role} role`,
          createdAt: new Date(`2024-01-0${index + 1}`),
          updatedAt: new Date(`2024-01-0${index + 1}`),
          deleted: false,
        },
      }));

      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(memberships)
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(5);
      
      roles.forEach(role => {
        const workspace = result.find(w => w.userRole === role);
        expect(workspace).toBeDefined();
        expect(workspace?.userRole).toBe(role);
      });
    });
  });

  describe("Member Count Security", () => {
    test("should accurately calculate member counts without exposing internal member details", async () => {
      const ownedWorkspaces = [
        {
          id: "ws-with-members",
          name: "Workspace with Members",
          slug: "workspace-with-members",
          ownerId: testUserId,
          description: "Has multiple members",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
        },
      ];

      // Simulate member count data (4 members total)
      const memberCounts = [
        { workspaceId: "ws-with-members" },
        { workspaceId: "ws-with-members" },
        { workspaceId: "ws-with-members" },
        { workspaceId: "ws-with-members" },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(memberCounts);

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(1);
      // Should be 5 total (4 members + 1 owner)
      expect(result[0].memberCount).toBe(5);
    });

    test("should handle workspaces with no additional members", async () => {
      const ownedWorkspaces = [
        {
          id: "ws-solo",
          name: "Solo Workspace",
          slug: "solo-workspace",
          ownerId: testUserId,
          description: "Only owner",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]); // No members

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(1);
      // Should be 1 (just the owner)
      expect(result[0].memberCount).toBe(1);
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    test("should return empty array when user has no workspaces", async () => {
      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(testUserId);

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    test("should handle database errors gracefully", async () => {
      const dbError = new Error("Database connection failed");
      (db.workspace.findMany as Mock).mockRejectedValue(dbError);

      await expect(getUserWorkspaces(testUserId)).rejects.toThrow("Database connection failed");
    });

    test("should handle malformed workspace data safely", async () => {
      const malformedMemberships = [
        {
          userId: testUserId,
          role: "DEVELOPER",
          leftAt: null,
          workspace: null, // Malformed data
        },
        {
          userId: testUserId,
          role: "ADMIN",
          leftAt: null,
          workspace: {
            id: "valid-ws",
            name: "Valid Workspace",
            slug: "valid-workspace",
            ownerId: otherUserId,
            description: "Valid workspace",
            createdAt: new Date("2024-01-01"),
            updatedAt: new Date("2024-01-01"),
            deleted: false,
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(malformedMemberships)
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(testUserId);

      // Should filter out malformed data and only return valid workspace
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("valid-ws");
    });

    test("should handle members who have left workspaces (leftAt not null)", async () => {
      // Only return active memberships (leftAt: null) - this simulates the database query filter
      const activeMemberships = [
        {
          userId: testUserId,
          role: "ADMIN",
          leftAt: null, // Still active
          workspace: {
            id: "ws-active",
            name: "Active Workspace",
            slug: "active-workspace",
            ownerId: otherUserId,
            description: "Still active in this workspace",
            createdAt: new Date("2024-01-02"),
            updatedAt: new Date("2024-01-02"),
            deleted: false,
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(activeMemberships) // Only return active memberships
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(testUserId);

      // Should only include active membership (leftAt is null)
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("ws-active");
      expect(result[0].userRole).toBe("ADMIN");
    });
  });

  describe("Data Format and Structure", () => {
    test("should return properly formatted workspace data with ISO date strings", async () => {
      const testDate = new Date("2024-01-01T12:00:00.000Z");
      const ownedWorkspaces = [
        {
          id: "ws-format-test",
          name: "Format Test Workspace",
          slug: "format-test",
          ownerId: testUserId,
          description: "Testing date format",
          createdAt: testDate,
          updatedAt: testDate,
          deleted: false,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(1);
      const workspace = result[0];

      expect(workspace.createdAt).toBe("2024-01-01T12:00:00.000Z");
      expect(workspace.updatedAt).toBe("2024-01-01T12:00:00.000Z");
      expect(typeof workspace.createdAt).toBe("string");
      expect(typeof workspace.updatedAt).toBe("string");
    });

    test("should maintain consistent data structure across all returned workspaces", async () => {
      const ownedWorkspaces = [
        {
          id: "ws-owned",
          name: "Owned Workspace",
          slug: "owned-workspace",
          ownerId: testUserId,
          description: "User owned workspace",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
        },
      ];

      const memberships = [
        {
          userId: testUserId,
          role: "DEVELOPER",
          leftAt: null,
          workspace: {
            id: "ws-member",
            name: "Member Workspace",
            slug: "member-workspace",
            ownerId: otherUserId,
            description: "Member workspace",
            createdAt: new Date("2024-01-02"),
            updatedAt: new Date("2024-01-02"),
            deleted: false,
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(memberships)
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(2);

      // Verify consistent structure
      result.forEach(workspace => {
        expect(workspace).toHaveProperty("id");
        expect(workspace).toHaveProperty("name");
        expect(workspace).toHaveProperty("description");
        expect(workspace).toHaveProperty("slug");
        expect(workspace).toHaveProperty("ownerId");
        expect(workspace).toHaveProperty("createdAt");
        expect(workspace).toHaveProperty("updatedAt");
        expect(workspace).toHaveProperty("userRole");
        expect(workspace).toHaveProperty("memberCount");

        expect(typeof workspace.id).toBe("string");
        expect(typeof workspace.name).toBe("string");
        expect(typeof workspace.slug).toBe("string");
        expect(typeof workspace.ownerId).toBe("string");
        expect(typeof workspace.createdAt).toBe("string");
        expect(typeof workspace.updatedAt).toBe("string");
        expect(typeof workspace.userRole).toBe("string");
        expect(typeof workspace.memberCount).toBe("number");
      });
    });
  });
});