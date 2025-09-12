import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
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

describe("getUserWorkspaces - Comprehensive Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("Database Query Operations", () => {
    test("should make correct parallel database queries", async () => {
      const userId = "test-user-123";
      const mockOwnedWorkspaces = [];
      const mockMemberships = [];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships) // First call for memberships
        .mockResolvedValueOnce([]); // Second call for member counts

      await getUserWorkspaces(userId);

      // Verify correct queries are made
      expect(db.workspace.findMany).toHaveBeenCalledWith({
        where: {
          ownerId: userId,
          deleted: false,
        },
      });

      expect(db.workspaceMember.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          userId,
          leftAt: null,
        },
        include: {
          workspace: true,
        },
      });
    });

    test("should optimize member count queries when workspaces exist", async () => {
      const userId = "test-user-123";
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Owned Workspace",
          slug: "owned-workspace",
          ownerId: userId,
          description: "Test workspace",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
      ];

      const mockMemberships = [
        {
          role: "DEVELOPER",
          workspace: {
            id: "ws2",
            name: "Member Workspace",
            slug: "member-workspace",
            ownerId: "other-user",
            description: "Member workspace",
            deleted: false,
            createdAt: new Date("2024-01-02"),
            updatedAt: new Date("2024-01-02"),
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce([
          { workspaceId: "ws1" },
          { workspaceId: "ws1" },
          { workspaceId: "ws2" },
        ]);

      await getUserWorkspaces(userId);

      // Verify member count query is optimized with workspace IDs
      expect(db.workspaceMember.findMany).toHaveBeenNthCalledWith(2, {
        where: {
          workspaceId: { in: ["ws1", "ws2"] },
          leftAt: null,
        },
        select: {
          workspaceId: true,
        },
      });
    });

    test("should skip member count query when no workspaces exist", async () => {
      const userId = "test-user-123";
      
      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock).mockResolvedValue([]);

      const result = await getUserWorkspaces(userId);

      expect(result).toEqual([]);
      // Should only make 2 calls (owned workspaces and memberships), not 3
      expect(db.workspaceMember.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("Data Processing and Aggregation", () => {
    test("should correctly aggregate owned and member workspaces", async () => {
      const userId = "test-user-123";
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "My Workspace",
          slug: "my-workspace",
          ownerId: userId,
          description: "My owned workspace",
          createdAt: new Date("2024-01-01T10:00:00Z"),
          updatedAt: new Date("2024-01-01T10:00:00Z"),
        },
      ];

      const mockMemberships = [
        {
          role: "ADMIN" as WorkspaceRole,
          workspace: {
            id: "ws2",
            name: "Team Workspace",
            slug: "team-workspace",
            ownerId: "other-user",
            description: "Team collaboration space",
            deleted: false,
            createdAt: new Date("2024-01-02T10:00:00Z"),
            updatedAt: new Date("2024-01-02T10:00:00Z"),
          },
        },
      ];

      const mockMemberCounts = [
        { workspaceId: "ws1" }, // 1 member for ws1
        { workspaceId: "ws2" }, // 1 member for ws2  
        { workspaceId: "ws2" }, // 2nd member for ws2
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce(mockMemberCounts);

      const result = await getUserWorkspaces(userId);

      expect(result).toHaveLength(2);
      
      // Find workspaces by name for consistent testing
      const myWorkspace = result.find(w => w.name === "My Workspace");
      const teamWorkspace = result.find(w => w.name === "Team Workspace");

      expect(myWorkspace).toMatchObject({
        id: "ws1",
        name: "My Workspace",
        slug: "my-workspace",
        description: "My owned workspace",
        ownerId: userId,
        userRole: "OWNER",
        memberCount: 2, // 1 member + 1 owner
        createdAt: "2024-01-01T10:00:00.000Z",
        updatedAt: "2024-01-01T10:00:00.000Z",
      });

      expect(teamWorkspace).toMatchObject({
        id: "ws2",
        name: "Team Workspace",
        slug: "team-workspace",
        description: "Team collaboration space",
        ownerId: "other-user",
        userRole: "ADMIN",
        memberCount: 3, // 2 members + 1 owner
        createdAt: "2024-01-02T10:00:00.000Z",
        updatedAt: "2024-01-02T10:00:00.000Z",
      });
    });

    test("should handle member count calculation correctly", async () => {
      const userId = "test-user-123";
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Solo Workspace",
          slug: "solo-workspace",
          ownerId: userId,
          description: null,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
      ];

      const mockMemberCounts = [
        { workspaceId: "ws1" },
        { workspaceId: "ws1" },
        { workspaceId: "ws1" },
        { workspaceId: "ws1" }, // 4 total members
        { workspaceId: "other-ws" }, // Should not affect count
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(mockMemberCounts);

      const result = await getUserWorkspaces(userId);

      expect(result).toHaveLength(1);
      expect(result[0].memberCount).toBe(5); // 4 members + 1 owner
    });

    test("should filter out deleted member workspaces", async () => {
      const userId = "test-user-123";
      const mockMemberships = [
        {
          role: "DEVELOPER" as WorkspaceRole,
          workspace: {
            id: "ws1",
            name: "Active Workspace",
            slug: "active-workspace",
            ownerId: "other-user",
            description: "Active workspace",
            deleted: false,
            createdAt: new Date("2024-01-01"),
            updatedAt: new Date("2024-01-01"),
          },
        },
        {
          role: "ADMIN" as WorkspaceRole,
          workspace: {
            id: "ws2",
            name: "Deleted Workspace",
            slug: "deleted-workspace",
            ownerId: "other-user",
            description: "Deleted workspace",
            deleted: true, // This should be filtered out
            createdAt: new Date("2024-01-02"),
            updatedAt: new Date("2024-01-02"),
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce([{ workspaceId: "ws1" }]);

      const result = await getUserWorkspaces(userId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Active Workspace");
      expect(result[0].id).toBe("ws1");
    });
  });

  describe("Data Transformation and Formatting", () => {
    test("should convert dates to ISO strings", async () => {
      const userId = "test-user-123";
      const testDate = new Date("2024-03-15T14:30:00.000Z");
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Date Test Workspace",
          slug: "date-test",
          ownerId: userId,
          description: "Testing date formatting",
          createdAt: testDate,
          updatedAt: testDate,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(userId);

      expect(result[0].createdAt).toBe("2024-03-15T14:30:00.000Z");
      expect(result[0].updatedAt).toBe("2024-03-15T14:30:00.000Z");
      expect(typeof result[0].createdAt).toBe("string");
      expect(typeof result[0].updatedAt).toBe("string");
    });

    test("should handle null descriptions correctly", async () => {
      const userId = "test-user-123";
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "No Description Workspace",
          slug: "no-description",
          ownerId: userId,
          description: null,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(userId);

      expect(result[0].description).toBeNull();
    });

    test("should sort workspaces alphabetically by name", async () => {
      const userId = "test-user-123";
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Zebra Workspace",
          slug: "zebra-workspace",
          ownerId: userId,
          description: "Last alphabetically",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
        {
          id: "ws2", 
          name: "Alpha Workspace",
          slug: "alpha-workspace",
          ownerId: userId,
          description: "First alphabetically",
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(userId);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("Alpha Workspace");
      expect(result[1].name).toBe("Zebra Workspace");
    });
  });

  describe("Role Assignment", () => {
    test("should assign OWNER role for owned workspaces", async () => {
      const userId = "test-user-123";
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "My Workspace",
          slug: "my-workspace",
          ownerId: userId,
          description: "I own this",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(userId);

      expect(result[0].userRole).toBe("OWNER");
      expect(result[0].ownerId).toBe(userId);
    });

    test("should preserve member roles for member workspaces", async () => {
      const userId = "test-user-123";
      const mockMemberships = [
        {
          role: "PM" as WorkspaceRole,
          workspace: {
            id: "ws1",
            name: "PM Workspace",
            slug: "pm-workspace",
            ownerId: "other-user",
            description: "I am PM here",
            deleted: false,
            createdAt: new Date("2024-01-01"),
            updatedAt: new Date("2024-01-01"),
          },
        },
        {
          role: "DEVELOPER" as WorkspaceRole,
          workspace: {
            id: "ws2",
            name: "Dev Workspace",
            slug: "dev-workspace",
            ownerId: "other-user",
            description: "I develop here",
            deleted: false,
            createdAt: new Date("2024-01-02"),
            updatedAt: new Date("2024-01-02"),
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(userId);

      expect(result).toHaveLength(2);
      const devWorkspace = result.find(w => w.name === "Dev Workspace");
      const pmWorkspace = result.find(w => w.name === "PM Workspace");
      
      expect(devWorkspace?.userRole).toBe("DEVELOPER");
      expect(pmWorkspace?.userRole).toBe("PM");
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    test("should handle empty results gracefully", async () => {
      const userId = "test-user-123";
      
      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock).mockResolvedValue([]);

      const result = await getUserWorkspaces(userId);

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });

    test("should handle missing workspace in membership gracefully", async () => {
      const userId = "test-user-123";
      const mockMemberships = [
        {
          role: "DEVELOPER" as WorkspaceRole,
          workspace: null, // Missing workspace
        },
        {
          role: "ADMIN" as WorkspaceRole,
          workspace: {
            id: "ws1",
            name: "Valid Workspace",
            slug: "valid-workspace",
            ownerId: "other-user",
            description: "Valid workspace",
            deleted: false,
            createdAt: new Date("2024-01-01"),
            updatedAt: new Date("2024-01-01"),
          },
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce([]);

      const result = await getUserWorkspaces(userId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Valid Workspace");
    });

    test("should handle database query failures", async () => {
      const userId = "test-user-123";
      const dbError = new Error("Database connection failed");
      
      (db.workspace.findMany as Mock).mockRejectedValue(dbError);

      await expect(getUserWorkspaces(userId)).rejects.toThrow("Database connection failed");
    });

    test("should handle workspace member query failures", async () => {
      const userId = "test-user-123";
      const dbError = new Error("Member query failed");
      
      (db.workspace.findMany as Mock).mockResolvedValue([]);
      (db.workspaceMember.findMany as Mock).mockRejectedValue(dbError);

      await expect(getUserWorkspaces(userId)).rejects.toThrow("Member query failed");
    });

    test("should handle large datasets efficiently", async () => {
      const userId = "test-user-123";
      
      // Create large mock dataset
      const mockOwnedWorkspaces = Array.from({ length: 50 }, (_, i) => ({
        id: `owned-ws-${i}`,
        name: `Owned Workspace ${i}`,
        slug: `owned-workspace-${i}`,
        ownerId: userId,
        description: `Owned workspace number ${i}`,
        createdAt: new Date(2024, 0, i + 1),
        updatedAt: new Date(2024, 0, i + 1),
      }));

      const mockMemberships = Array.from({ length: 30 }, (_, i) => ({
        role: (i % 2 === 0 ? "DEVELOPER" : "PM") as WorkspaceRole,
        workspace: {
          id: `member-ws-${i}`,
          name: `Member Workspace ${i}`,
          slug: `member-workspace-${i}`,
          ownerId: `other-user-${i}`,
          description: `Member workspace number ${i}`,
          deleted: false,
          createdAt: new Date(2024, 1, i + 1),
          updatedAt: new Date(2024, 1, i + 1),
        },
      }));

      // Create member count data
      const mockMemberCounts = Array.from({ length: 200 }, (_, i) => ({
        workspaceId: `${i % 2 === 0 ? 'owned' : 'member'}-ws-${Math.floor(i / 4)}`,
      }));

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce(mockMemberCounts);

      const result = await getUserWorkspaces(userId);

      expect(result).toHaveLength(80); // 50 owned + 30 member
      expect(result[0].name.localeCompare(result[1].name)).toBeLessThanOrEqual(0); // Verify sorting
    });

    test("should handle workspaces with zero additional members", async () => {
      const userId = "test-user-123";
      const mockOwnedWorkspaces = [
        {
          id: "ws1",
          name: "Solo Workspace",
          slug: "solo-workspace", 
          ownerId: userId,
          description: "Just me",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]); // No members at all

      const result = await getUserWorkspaces(userId);

      expect(result).toHaveLength(1);
      expect(result[0].memberCount).toBe(1); // Just the owner
    });
  });

  describe("Performance and Optimization", () => {
    test("should use Promise.all for parallel database queries", async () => {
      const userId = "test-user-123";
      
      // Mock implementations that resolve after different delays
      (db.workspace.findMany as Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve([]), 50))
      );
      (db.workspaceMember.findMany as Mock).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve([]), 50))
      );

      const startTime = Date.now();
      await getUserWorkspaces(userId);
      const endTime = Date.now();

      // Parallel execution should be faster than sequential (less than 80ms for 2x 50ms queries)
      // In a sequential execution, it would take ~100ms, parallel should be ~50ms
      expect(endTime - startTime).toBeLessThan(80);
    });

    test("should batch member count queries efficiently", async () => {
      const userId = "test-user-123";
      const mockOwnedWorkspaces = [
        { id: "ws1", name: "W1", slug: "w1", ownerId: userId, description: null, createdAt: new Date(), updatedAt: new Date() },
        { id: "ws2", name: "W2", slug: "w2", ownerId: userId, description: null, createdAt: new Date(), updatedAt: new Date() },
      ];

      const mockMemberships = [
        {
          role: "DEVELOPER" as WorkspaceRole,
          workspace: {
            id: "ws3", name: "W3", slug: "w3", ownerId: "other", description: null, deleted: false,
            createdAt: new Date(), updatedAt: new Date(),
          }
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(mockOwnedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(mockMemberships)
        .mockResolvedValueOnce([]);

      await getUserWorkspaces(userId);

      // Should make exactly one batched query for all workspace IDs
      expect(db.workspaceMember.findMany).toHaveBeenNthCalledWith(2, {
        where: {
          workspaceId: { in: ["ws1", "ws2", "ws3"] },
          leftAt: null,
        },
        select: {
          workspaceId: true,
        },
      });
    });
  });
});