import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { getUserWorkspaces } from "@/services/workspace";
import { db } from "@/lib/db";

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

describe("getUserWorkspaces - lastAccessedAt Sorting Tests", () => {
  const testUserId = "test-user-sort-123";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("Sorting by lastAccessedAt", () => {
    test("should sort workspaces by lastAccessedAt with most recent first", async () => {
      const now = new Date("2024-12-10T10:00:00Z");
      const hourAgo = new Date("2024-12-10T09:00:00Z");
      const dayAgo = new Date("2024-12-09T10:00:00Z");

      const ownedWorkspaces = [
        {
          id: "ws1",
          name: "Workspace A",
          slug: "workspace-a",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
        {
          id: "ws2",
          name: "Workspace B",
          slug: "workspace-b",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
        {
          id: "ws3",
          name: "Workspace C",
          slug: "workspace-c",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-03"),
          updatedAt: new Date("2024-01-03"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
      ];

      const ownerMemberships = [
        {
          workspaceId: "ws1",
          lastAccessedAt: hourAgo,
        },
        {
          workspaceId: "ws2",
          lastAccessedAt: now,
        },
        {
          workspaceId: "ws3",
          lastAccessedAt: dayAgo,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([]) // First call for memberships
        .mockResolvedValueOnce(ownerMemberships) // Second call for owner memberships
        .mockResolvedValueOnce([]); // Third call for member counts

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(3);
      // Most recent first: ws2 (now), ws1 (hourAgo), ws3 (dayAgo)
      expect(result[0].slug).toBe("workspace-b");
      expect(result[1].slug).toBe("workspace-a");
      expect(result[2].slug).toBe("workspace-c");
    });

    test("should place workspaces with null lastAccessedAt at the end, sorted alphabetically", async () => {
      const now = new Date("2024-12-10T10:00:00Z");

      const ownedWorkspaces = [
        {
          id: "ws1",
          name: "Zebra Workspace",
          slug: "zebra-workspace",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
        {
          id: "ws2",
          name: "Apple Workspace",
          slug: "apple-workspace",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
        {
          id: "ws3",
          name: "Recently Accessed",
          slug: "recently-accessed",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-03"),
          updatedAt: new Date("2024-01-03"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
        {
          id: "ws4",
          name: "Banana Workspace",
          slug: "banana-workspace",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-04"),
          updatedAt: new Date("2024-01-04"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
      ];

      const ownerMemberships = [
        {
          workspaceId: "ws3",
          lastAccessedAt: now,
        },
        // ws1, ws2, ws4 have no lastAccessedAt (null)
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([]) // First call for memberships
        .mockResolvedValueOnce(ownerMemberships) // Second call for owner memberships
        .mockResolvedValueOnce([]); // Third call for member counts

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(4);
      // First: Recently Accessed (has timestamp)
      expect(result[0].slug).toBe("recently-accessed");
      expect(result[0].lastAccessedAt).not.toBeNull();
      
      // Then: alphabetically sorted null values: Apple, Banana, Zebra
      expect(result[1].slug).toBe("apple-workspace");
      expect(result[1].lastAccessedAt).toBeNull();
      expect(result[2].slug).toBe("banana-workspace");
      expect(result[2].lastAccessedAt).toBeNull();
      expect(result[3].slug).toBe("zebra-workspace");
      expect(result[3].lastAccessedAt).toBeNull();
    });

    test("should handle mixed owned and member workspaces with varying lastAccessedAt", async () => {
      const now = new Date("2024-12-10T10:00:00Z");
      const yesterday = new Date("2024-12-09T10:00:00Z");
      const weekAgo = new Date("2024-12-03T10:00:00Z");

      const ownedWorkspaces = [
        {
          id: "ws-owned-1",
          name: "My Owned Workspace",
          slug: "my-owned",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
        {
          id: "ws-owned-2",
          name: "Another Owned",
          slug: "another-owned",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
      ];

      const memberships = [
        {
          userId: testUserId,
          role: "DEVELOPER",
          leftAt: null,
          lastAccessedAt: yesterday,
          workspace: {
            id: "ws-member-1",
            name: "Team Workspace",
            slug: "team-workspace",
            ownerId: "other-user-1",
            description: null,
            createdAt: new Date("2024-01-03"),
            updatedAt: new Date("2024-01-03"),
            deleted: false,
            logoUrl: null,
            logoKey: null,
            nodeTypeOrder: null,
          },
        },
        {
          userId: testUserId,
          role: "VIEWER",
          leftAt: null,
          lastAccessedAt: null, // Never accessed
          workspace: {
            id: "ws-member-2",
            name: "Client Workspace",
            slug: "client-workspace",
            ownerId: "other-user-2",
            description: null,
            createdAt: new Date("2024-01-04"),
            updatedAt: new Date("2024-01-04"),
            deleted: false,
            logoUrl: null,
            logoKey: null,
            nodeTypeOrder: null,
          },
        },
      ];

      const ownerMemberships = [
        {
          workspaceId: "ws-owned-1",
          lastAccessedAt: now, // Most recent
        },
        {
          workspaceId: "ws-owned-2",
          lastAccessedAt: weekAgo,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce(memberships) // First call for memberships
        .mockResolvedValueOnce(ownerMemberships) // Second call for owner memberships
        .mockResolvedValueOnce([]); // Third call for member counts

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(4);
      
      // Order should be: now, yesterday, weekAgo, null (alphabetically)
      expect(result[0].slug).toBe("my-owned"); // now
      expect(result[0].lastAccessedAt).toBe(now.toISOString());
      
      expect(result[1].slug).toBe("team-workspace"); // yesterday
      expect(result[1].lastAccessedAt).toBe(yesterday.toISOString());
      
      expect(result[2].slug).toBe("another-owned"); // weekAgo
      expect(result[2].lastAccessedAt).toBe(weekAgo.toISOString());
      
      expect(result[3].slug).toBe("client-workspace"); // null
      expect(result[3].lastAccessedAt).toBeNull();
    });

    test("should sort all null lastAccessedAt workspaces alphabetically by name", async () => {
      const ownedWorkspaces = [
        {
          id: "ws1",
          name: "Delta Project",
          slug: "delta-project",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
        {
          id: "ws2",
          name: "Alpha Project",
          slug: "alpha-project",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
        {
          id: "ws3",
          name: "Charlie Project",
          slug: "charlie-project",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-03"),
          updatedAt: new Date("2024-01-03"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
        {
          id: "ws4",
          name: "Bravo Project",
          slug: "bravo-project",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-04"),
          updatedAt: new Date("2024-01-04"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([]) // First call for memberships
        .mockResolvedValueOnce([]) // Second call for owner memberships (all null)
        .mockResolvedValueOnce([]); // Third call for member counts

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(4);
      // All null, should be alphabetical: Alpha, Bravo, Charlie, Delta
      expect(result[0].name).toBe("Alpha Project");
      expect(result[1].name).toBe("Bravo Project");
      expect(result[2].name).toBe("Charlie Project");
      expect(result[3].name).toBe("Delta Project");
      
      // All should have null lastAccessedAt
      result.forEach(workspace => {
        expect(workspace.lastAccessedAt).toBeNull();
      });
    });

    test("should handle workspaces with identical lastAccessedAt timestamps", async () => {
      const sameTime = new Date("2024-12-10T10:00:00Z");

      const ownedWorkspaces = [
        {
          id: "ws1",
          name: "Workspace Z",
          slug: "workspace-z",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
        {
          id: "ws2",
          name: "Workspace A",
          slug: "workspace-a",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
      ];

      const ownerMemberships = [
        {
          workspaceId: "ws1",
          lastAccessedAt: sameTime,
        },
        {
          workspaceId: "ws2",
          lastAccessedAt: sameTime,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([]) // First call for memberships
        .mockResolvedValueOnce(ownerMemberships) // Second call for owner memberships
        .mockResolvedValueOnce([]); // Third call for member counts

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(2);
      // When timestamps are identical, order is preserved from database
      // Both should have the same timestamp
      expect(result[0].lastAccessedAt).toBe(sameTime.toISOString());
      expect(result[1].lastAccessedAt).toBe(sameTime.toISOString());
    });

    test("should handle edge case with very old and very recent timestamps", async () => {
      const veryRecent = new Date("2024-12-10T10:00:00Z");
      const veryOld = new Date("2020-01-01T00:00:00Z");

      const ownedWorkspaces = [
        {
          id: "ws-old",
          name: "Old Workspace",
          slug: "old-workspace",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2020-01-01"),
          updatedAt: new Date("2020-01-01"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
        {
          id: "ws-new",
          name: "New Workspace",
          slug: "new-workspace",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
      ];

      const ownerMemberships = [
        {
          workspaceId: "ws-old",
          lastAccessedAt: veryOld,
        },
        {
          workspaceId: "ws-new",
          lastAccessedAt: veryRecent,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([]) // First call for memberships
        .mockResolvedValueOnce(ownerMemberships) // Second call for owner memberships
        .mockResolvedValueOnce([]); // Third call for member counts

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(2);
      // Most recent should be first
      expect(result[0].slug).toBe("new-workspace");
      expect(result[0].lastAccessedAt).toBe(veryRecent.toISOString());
      
      expect(result[1].slug).toBe("old-workspace");
      expect(result[1].lastAccessedAt).toBe(veryOld.toISOString());
    });

    test("should handle single workspace with lastAccessedAt", async () => {
      const now = new Date("2024-12-10T10:00:00Z");

      const ownedWorkspaces = [
        {
          id: "ws1",
          name: "Single Workspace",
          slug: "single-workspace",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
      ];

      const ownerMemberships = [
        {
          workspaceId: "ws1",
          lastAccessedAt: now,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([]) // First call for memberships
        .mockResolvedValueOnce(ownerMemberships) // Second call for owner memberships
        .mockResolvedValueOnce([]); // Third call for member counts

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe("single-workspace");
      expect(result[0].lastAccessedAt).toBe(now.toISOString());
    });

    test("should handle single workspace with null lastAccessedAt", async () => {
      const ownedWorkspaces = [
        {
          id: "ws1",
          name: "Never Accessed",
          slug: "never-accessed",
          ownerId: testUserId,
          description: null,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          deleted: false,
          logoUrl: null,
          logoKey: null,
          nodeTypeOrder: null,
        },
      ];

      (db.workspace.findMany as Mock).mockResolvedValue(ownedWorkspaces);
      (db.workspaceMember.findMany as Mock)
        .mockResolvedValueOnce([]) // First call for memberships
        .mockResolvedValueOnce([]) // Second call for owner memberships (none)
        .mockResolvedValueOnce([]); // Third call for member counts

      const result = await getUserWorkspaces(testUserId);

      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe("never-accessed");
      expect(result[0].lastAccessedAt).toBeNull();
    });
  });
});
