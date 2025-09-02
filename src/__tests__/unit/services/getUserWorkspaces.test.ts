import { describe, test, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { getUserWorkspaces } from "@/services/workspace";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";

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

describe("getUserWorkspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("successful scenarios", () => {
    test("should return owned workspaces only", async () => {
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Alpha Workspace",
          description: "First workspace",
          slug: "alpha-workspace",
          ownerId: "user1",
          createdAt: new Date("2024-01-01T10:00:00.000Z"),
          updatedAt: new Date("2024-01-01T10:00:00.000Z"),
          deleted: false,
        },
        {
          id: "ws2", 
          name: "Beta Workspace",
          description: null,
          slug: "beta-workspace",
          ownerId: "user1",
          createdAt: new Date("2024-01-02T10:00:00.000Z"),
          updatedAt: new Date("2024-01-02T10:00:00.000Z"),
          deleted: false,
        },
      ];

      const mockMemberCounts = [
        { workspaceId: "ws1" },
        { workspaceId: "ws1" },
        { workspaceId: "ws2" },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([]) // No memberships
        .mockResolvedValueOnce(mockMemberCounts); // Member counts

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "ws1",
        name: "Alpha Workspace",
        description: "First workspace",
        slug: "alpha-workspace",
        ownerId: "user1",
        createdAt: "2024-01-01T10:00:00.000Z",
        updatedAt: "2024-01-01T10:00:00.000Z",
        userRole: "OWNER",
        memberCount: 3, // 2 members + 1 owner
      });
      expect(result[1]).toEqual({
        id: "ws2",
        name: "Beta Workspace",
        description: null,
        slug: "beta-workspace",
        ownerId: "user1",
        createdAt: "2024-01-02T10:00:00.000Z",
        updatedAt: "2024-01-02T10:00:00.000Z",
        userRole: "OWNER",
        memberCount: 2, // 1 member + 1 owner
      });

      // Verify database calls
      expect(db.workspace.findMany).toHaveBeenCalledWith({
        where: {
          ownerId: "user1",
          deleted: false,
        },
      });
      expect(db.workspaceMember.findMany).toHaveBeenCalledTimes(2);
    });

    test("should return member workspaces only", async () => {
      const mockMemberships = [
        {
          role: "DEVELOPER",
          workspace: {
            id: "ws3",
            name: "Dev Workspace",
            description: "Development workspace",
            slug: "dev-workspace",
            ownerId: "other-user",
            createdAt: new Date("2024-01-03T10:00:00.000Z"),
            updatedAt: new Date("2024-01-03T10:00:00.000Z"),
            deleted: false,
          },
        },
        {
          role: "ADMIN",
          workspace: {
            id: "ws4",
            name: "Admin Workspace",
            description: null,
            slug: "admin-workspace",
            ownerId: "another-user",
            createdAt: new Date("2024-01-04T10:00:00.000Z"),
            updatedAt: new Date("2024-01-04T10:00:00.000Z"),
            deleted: false,
          },
        },
      ];

      const mockMemberCounts = [
        { workspaceId: "ws3" },
        { workspaceId: "ws3" },
        { workspaceId: "ws4" },
        { workspaceId: "ws4" },
        { workspaceId: "ws4" },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue([]); // No owned workspaces
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships) // Memberships
        .mockResolvedValueOnce(mockMemberCounts); // Member counts

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "ws4",
        name: "Admin Workspace",
        description: null,
        slug: "admin-workspace",
        ownerId: "another-user",
        createdAt: "2024-01-04T10:00:00.000Z",
        updatedAt: "2024-01-04T10:00:00.000Z",
        userRole: "ADMIN",
        memberCount: 4, // 3 members + 1 owner
      });
      expect(result[1]).toEqual({
        id: "ws3",
        name: "Dev Workspace",
        description: "Development workspace",
        slug: "dev-workspace",
        ownerId: "other-user",
        createdAt: "2024-01-03T10:00:00.000Z",
        updatedAt: "2024-01-03T10:00:00.000Z",
        userRole: "DEVELOPER",
        memberCount: 3, // 2 members + 1 owner
      });
    });

    test("should return mixed owned and member workspaces sorted by name", async () => {
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Zeta Owned",
          description: "Last alphabetically",
          slug: "zeta-owned",
          ownerId: "user1",
          createdAt: new Date("2024-01-01T10:00:00.000Z"),
          updatedAt: new Date("2024-01-01T10:00:00.000Z"),
          deleted: false,
        },
      ];

      const mockMemberships = [
        {
          role: "VIEWER",
          workspace: {
            id: "ws2",
            name: "Alpha Member",
            description: "First alphabetically",
            slug: "alpha-member",
            ownerId: "other-user",
            createdAt: new Date("2024-01-02T10:00:00.000Z"),
            updatedAt: new Date("2024-01-02T10:00:00.000Z"),
            deleted: false,
          },
        },
      ];

      const mockMemberCounts = [
        { workspaceId: "ws1" },
        { workspaceId: "ws2" },
        { workspaceId: "ws2" },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce(mockMemberCounts);

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(2);
      // Should be sorted alphabetically by name
      expect(result[0].name).toBe("Alpha Member");
      expect(result[0].userRole).toBe("VIEWER");
      expect(result[1].name).toBe("Zeta Owned");
      expect(result[1].userRole).toBe("OWNER");
    });
  });

  describe("edge cases", () => {
    test("should handle empty results", async () => {
      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock).mockResolvedValue([]);

      const result = await getUserWorkspaces("user1");

      expect(result).toEqual([]);
      expect(db.workspace.findMany).toHaveBeenCalledWith({
        where: {
          ownerId: "user1",
          deleted: false,
        },
      });
      expect(db.workspaceMember.findMany).toHaveBeenCalledWith({
        where: {
          userId: "user1",
          leftAt: null,
        },
        include: {
          workspace: true,
        },
      });
    });

    test("should filter out deleted member workspaces", async () => {
      const mockMemberships = [
        {
          role: "DEVELOPER",
          workspace: {
            id: "ws1",
            name: "Active Workspace",
            deleted: false,
            slug: "active-workspace",
            ownerId: "other-user",
            createdAt: new Date("2024-01-01T10:00:00.000Z"),
            updatedAt: new Date("2024-01-01T10:00:00.000Z"),
          },
        },
        {
          role: "ADMIN",
          workspace: {
            id: "ws2",
            name: "Deleted Workspace",
            deleted: true,
            slug: "deleted-workspace", 
            ownerId: "other-user",
            createdAt: new Date("2024-01-02T10:00:00.000Z"),
            updatedAt: new Date("2024-01-02T10:00:00.000Z"),
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce([]); // No member counts needed for filtered workspaces

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Active Workspace");
      expect(result[0].userRole).toBe("DEVELOPER");
    });

    test("should handle null workspace in membership", async () => {
      const mockMemberships = [
        {
          role: "DEVELOPER",
          workspace: null, // This should be filtered out
        },
        {
          role: "ADMIN",
          workspace: {
            id: "ws1",
            name: "Valid Workspace",
            deleted: false,
            description: null,
            slug: "valid-workspace",
            ownerId: "other-user",
            createdAt: new Date("2024-01-01T10:00:00.000Z"),
            updatedAt: new Date("2024-01-01T10:00:00.000Z"),
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce([{ workspaceId: "ws1" }]);

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Valid Workspace");
    });

    test("should handle zero member count", async () => {
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Empty Workspace",
          description: "No members",
          slug: "empty-workspace",
          ownerId: "user1",
          createdAt: new Date("2024-01-01T10:00:00.000Z"),
          updatedAt: new Date("2024-01-01T10:00:00.000Z"),
          deleted: false,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([]) // No memberships
        .mockResolvedValueOnce([]); // No members

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(1);
      expect(result[0].memberCount).toBe(1); // Just the owner
    });
  });

  describe("role assignments", () => {
    test("should assign OWNER role for owned workspaces", async () => {
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Owned Workspace",
          slug: "owned-workspace",
          ownerId: "user1",
          createdAt: new Date("2024-01-01T10:00:00.000Z"),
          updatedAt: new Date("2024-01-01T10:00:00.000Z"),
          deleted: false,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(1);
      expect(result[0].userRole).toBe("OWNER");
    });

    test("should preserve member roles for member workspaces", async () => {
      const roles = ["VIEWER", "STAKEHOLDER", "DEVELOPER", "PM", "ADMIN"] as const;
      
      const mockMemberships = roles.map((role, index) => ({
        role,
        workspace: {
          id: `ws${index + 1}`,
          name: `${role} Workspace`,
          slug: `${role.toLowerCase()}-workspace`,
          ownerId: "other-user",
          createdAt: new Date("2024-01-01T10:00:00.000Z"),
          updatedAt: new Date("2024-01-01T10:00:00.000Z"),
          deleted: false,
        },
      }));

      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(5);
      roles.forEach((role, index) => {
        const workspace = result.find(w => w.name === `${role} Workspace`);
        expect(workspace?.userRole).toBe(role);
      });
    });
  });

  describe("member count calculations", () => {
    test("should calculate member counts correctly", async () => {
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Workspace One",
          slug: "workspace-one",
          ownerId: "user1",
          createdAt: new Date("2024-01-01T10:00:00.000Z"),
          updatedAt: new Date("2024-01-01T10:00:00.000Z"),
          deleted: false,
        },
      ];

      const mockMemberships = [
        {
          role: "DEVELOPER",
          workspace: {
            id: "ws2",
            name: "Workspace Two",
            slug: "workspace-two",
            ownerId: "other-user",
            createdAt: new Date("2024-01-02T10:00:00.000Z"),
            updatedAt: new Date("2024-01-02T10:00:00.000Z"),
            deleted: false,
          },
        },
      ];

      // ws1 has 3 members total, ws2 has 2 members total
      const mockMemberCounts = [
        { workspaceId: "ws1" },
        { workspaceId: "ws1" },
        { workspaceId: "ws1" },
        { workspaceId: "ws2" },
        { workspaceId: "ws2" },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce(mockMemberCounts);

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(2);
      const ws1 = result.find(w => w.id === "ws1");
      const ws2 = result.find(w => w.id === "ws2");
      
      expect(ws1?.memberCount).toBe(4); // 3 members + 1 owner
      expect(ws2?.memberCount).toBe(3); // 2 members + 1 owner
    });

    test("should skip member count query when no workspaces", async () => {
      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock).mockResolvedValue([]);

      const result = await getUserWorkspaces("user1");

      expect(result).toEqual([]);
      // Should only be called twice (owned workspaces and memberships)
      expect(db.workspaceMember.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    test("should handle database error in owned workspaces query", async () => {
      const dbError = new Error("Database connection failed");
      (db.workspace.findMany as Mock).mockRejectedValue(dbError);

      await expect(getUserWorkspaces("user1")).rejects.toThrow("Database connection failed");
    });

    test("should handle database error in memberships query", async () => {
      const dbError = new Error("Membership query failed");
      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock).mockRejectedValue(dbError);

      await expect(getUserWorkspaces("user1")).rejects.toThrow("Membership query failed");
    });

    test("should handle database error in member count query", async () => {
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: "user1",
          createdAt: new Date("2024-01-01T10:00:00.000Z"),
          updatedAt: new Date("2024-01-01T10:00:00.000Z"),
          deleted: false,
        },
      ];

      const dbError = new Error("Member count query failed");
      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([]) // Memberships succeed
        .mockRejectedValueOnce(dbError); // Member count query fails

      await expect(getUserWorkspaces("user1")).rejects.toThrow("Member count query failed");
    });
  });

  describe("data transformation", () => {
    test("should convert dates to ISO strings", async () => {
      const testDate = new Date("2024-01-01T10:30:45.123Z");
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Test Workspace",
          slug: "test-workspace", 
          ownerId: "user1",
          createdAt: testDate,
          updatedAt: testDate,
          deleted: false,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(1);
      expect(result[0].createdAt).toBe("2024-01-01T10:30:45.123Z");
      expect(result[0].updatedAt).toBe("2024-01-01T10:30:45.123Z");
    });

    test("should handle null descriptions", async () => {
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Test Workspace",
          description: null,
          slug: "test-workspace",
          ownerId: "user1", 
          createdAt: new Date("2024-01-01T10:00:00.000Z"),
          updatedAt: new Date("2024-01-01T10:00:00.000Z"),
          deleted: false,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces("user1");

      expect(result).toHaveLength(1);
      expect(result[0].description).toBeNull();
    });
  });

  describe("query parameters", () => {
    test("should query owned workspaces with correct parameters", async () => {
      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock).mockResolvedValue([]);

      await getUserWorkspaces("test-user-id");

      expect(db.workspace.findMany).toHaveBeenCalledWith({
        where: {
          ownerId: "test-user-id",
          deleted: false,
        },
      });
    });

    test("should query memberships with correct parameters", async () => {
      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock).mockResolvedValue([]);

      await getUserWorkspaces("test-user-id");

      expect(db.workspaceMember.findMany).toHaveBeenCalledWith({
        where: {
          userId: "test-user-id",
          leftAt: null,
        },
        include: {
          workspace: true,
        },
      });
    });

    test("should query member counts with workspace IDs", async () => {
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Owned",
          slug: "owned",
          ownerId: "user1",
          createdAt: new Date(),
          updatedAt: new Date(),
          deleted: false,
        },
      ];

      const mockMemberships = [
        {
          role: "DEVELOPER",
          workspace: {
            id: "ws2",
            name: "Member",
            slug: "member",
            ownerId: "other-user",
            createdAt: new Date(),
            updatedAt: new Date(),
            deleted: false,
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce([]);

      await getUserWorkspaces("user1");

      expect(db.workspaceMember.findMany).toHaveBeenLastCalledWith({
        where: {
          workspaceId: { in: ["ws1", "ws2"] },
          leftAt: null,
        },
        select: {
          workspaceId: true,
        },
      });
    });
  });
});